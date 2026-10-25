import { TableAggregate } from "@convex-dev/aggregate";
import type { Change } from "convex-helpers/server/triggers";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel, Doc } from "./_generated/dataModel";
import { internalMutation, MutationCtx, QueryCtx } from "./_generated/server";

// Call-floor counts kept as running totals, so `households:counts` reads a few aggregate nodes
// instead of every household on every tick. Each value is its own namespace: a call ending
// (callStatus) never contends with a need estimate changing (outcome) or with another value.
//
// Writes are queued and counts read a moment stale. Applied in the household's own transaction,
// every write to a namespace touched one of its few B-tree nodes, so record writes for different
// homes conflicted: the stress test (docs/convex-stress.md) lost over half of 450 concurrent
// corrections that way. Queued, the aggregate's batch worker applies them one batch at a time.
const QUEUED = { async: true } as const;

export const OUTCOMES = ["unknown", "leaving", "needs_ride", "needs_accessible", "unreachable"] as const;
export const CALL_STATUSES = ["not_called", "in_call", "no_answer", "texted", "door_check", "complete"] as const;

type Outcome = Doc<"households">["outcome"];
type CallStatus = Doc<"households">["callStatus"];
type Counted<Namespace> = { Namespace: Namespace; Key: null; DataModel: DataModel; TableName: "households" };

const byOutcome = new TableAggregate<Counted<Outcome>>(components.householdsByOutcome, {
  namespace: (household) => household.outcome,
  sortKey: () => null,
});

const byCallStatus = new TableAggregate<Counted<CallStatus>>(components.householdsByCallStatus, {
  namespace: (household) => household.callStatus,
  sortKey: () => null,
});

// Registered as the households trigger in functions.ts. Most household writes touch estimates or
// the record, not these two fields, so they never reach the aggregates.
export async function syncHouseholdCounts(ctx: MutationCtx, change: Change<DataModel, "households">) {
  const { oldDoc, newDoc } = change;
  if (oldDoc && newDoc && oldDoc.outcome === newDoc.outcome && oldDoc.callStatus === newDoc.callStatus) return;
  for (const aggregate of [byOutcome, byCallStatus] as TableAggregate<Counted<string>>[]) {
    if (oldDoc && newDoc) await aggregate.replaceOrInsert(ctx, oldDoc, newDoc, QUEUED);
    else if (newDoc) await aggregate.insertIfDoesNotExist(ctx, newDoc, QUEUED);
    else if (oldDoc) await aggregate.deleteIfExists(ctx, oldDoc, QUEUED);
  }
}

export async function countHouseholds(ctx: QueryCtx) {
  const [outcomes, statuses] = await Promise.all([
    byOutcome.countBatch(ctx, OUTCOMES.map((namespace) => ({ namespace })), { stale: true }),
    byCallStatus.countBatch(ctx, CALL_STATUSES.map((namespace) => ({ namespace })), { stale: true }),
  ]);
  return {
    total: outcomes.reduce((sum, count) => sum + count, 0),
    outcome: Object.fromEntries(OUTCOMES.map((key, index) => [key, outcomes[index]])),
    callStatus: Object.fromEntries(CALL_STATUSES.map((key, index) => [key, statuses[index]])),
  };
}

const BACKFILL_BATCH = 200;

// Rebuilds both aggregates from the households table, then switches `households:counts` over.
// Run once after deploying: npx convex run householdCounts:backfill
// Clearing needs an empty write queue, so run it while no household is being written.
export const backfill = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    if (cursor === undefined) {
      for (const namespace of OUTCOMES) await byOutcome.clear(ctx, { namespace });
      for (const namespace of CALL_STATUSES) await byCallStatus.clear(ctx, { namespace });
    }
    const page = await ctx.db.query("households").paginate({ cursor: cursor ?? null, numItems: BACKFILL_BATCH });
    for (const household of page.page) {
      await byOutcome.insertIfDoesNotExist(ctx, household, QUEUED);
      await byCallStatus.insertIfDoesNotExist(ctx, household, QUEUED);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.householdCounts.backfill, { cursor: page.continueCursor });
      return null;
    }
    const control = await ctx.db.query("control").first();
    if (control) await ctx.db.patch("control", control._id, { householdCountsReadyAt: Date.now() });
    return null;
  },
});
