import { v } from "convex/values";
import { query, QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { assistanceRequired, callStatus, canLeave, exitPlan, medicalNeed, mobility } from "./schema";
import { simNow } from "./clock";

// Who 911 calls first is Claude's decision. The call planner (voice/callPlanRunner.ts) reads every
// home waiting for its warning call and ranks the most urgent ones, each with a reason; nextToCall
// dials that order first and the rest by callPriority. Without a plan for the current warning
// (planner not running, or Claude down) callPriority alone sets the order.

export const QUEUE_STATUSES = ["not_called", "no_answer"] as const;
export const MAX_PLANNED = 40;
const MAX_CANDIDATES = 300;
const MAX_REASON_LENGTH = 160;

async function warningIssuedAt(ctx: QueryCtx) {
  return (await ctx.db.query("control").first())?.warningIssuedAt ?? null;
}

async function planFor(ctx: QueryCtx, issuedAt: number) {
  return await ctx.db
    .query("callPlans")
    .withIndex("by_warningIssuedAt", (q) => q.eq("warningIssuedAt", issuedAt))
    .unique();
}

// The current warning's plan, most urgent first, with the reason for each home.
export async function currentPlan(ctx: QueryCtx): Promise<Map<Id<"households">, string>> {
  const issuedAt = await warningIssuedAt(ctx);
  const plan = issuedAt === null ? null : await planFor(ctx, issuedAt);
  return new Map((plan?.ranked ?? []).map(({ householdId, reason }) => [householdId, reason]));
}

const candidateShape = v.object({
  _id: v.id("households"),
  minutesLeft: v.number(),
  needProbability: v.number(),
  callStatus,
  attempts: v.number(),
  peopleCount: v.optional(v.number()),
  canLeave: v.optional(canLeave),
  hasCar: v.optional(v.boolean()),
  mobility: v.optional(mobility),
  assistanceRequired: v.optional(assistanceRequired),
  medical: v.optional(v.array(medicalNeed)),
  exitPlan: v.optional(exitPlan),
});

const candidateFrom = (h: Doc<"households">, now: number) => ({
  _id: h._id,
  minutesLeft: Math.round((h.fireArrivalAt - now) / 60_000),
  needProbability: h.needProbability,
  callStatus: h.callStatus,
  attempts: h.attempts,
  peopleCount: h.peopleCount,
  canLeave: h.canLeave,
  hasCar: h.hasCar,
  mobility: h.mobility,
  assistanceRequired: h.assistanceRequired,
  medical: h.medical,
  exitPlan: h.ready?.exitPlan,
});

// Every in-zone home still waiting for its warning call, as the planner sees it.
export const candidates = query({
  args: {},
  returns: v.object({
    warningIssuedAt: v.union(v.number(), v.null()),
    planned: v.boolean(),
    homes: v.array(candidateShape),
  }),
  handler: async (ctx) => {
    const issuedAt = await warningIssuedAt(ctx);
    if (issuedAt === null) return { warningIssuedAt: null, planned: false, homes: [] };
    const now = await simNow(ctx);
    const lists = await Promise.all(
      QUEUE_STATUSES.map((status) =>
        ctx.db
          .query("households")
          .withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", status))
          .order("desc")
          .take(MAX_CANDIDATES),
      ),
    );
    const homes = lists
      .flat()
      .filter((h) => h.inZone)
      .sort((a, b) => b.callPriority - a.callPriority)
      .slice(0, MAX_CANDIDATES)
      .map((h) => candidateFrom(h, now));
    return { warningIssuedAt: issuedAt, planned: (await planFor(ctx, issuedAt)) !== null, homes };
  },
});

// Replaces the plan for this warning. A plan made before a reset or for another warning is dropped.
export const save = mutation({
  args: {
    warningIssuedAt: v.number(),
    model: v.string(),
    ranked: v.array(v.object({ householdId: v.id("households"), reason: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if ((await warningIssuedAt(ctx)) !== args.warningIssuedAt) return null;
    const ranked = args.ranked
      .filter((entry, index) => args.ranked.findIndex((other) => other.householdId === entry.householdId) === index)
      .slice(0, MAX_PLANNED)
      .map(({ householdId, reason }) => ({ householdId, reason: reason.trim().slice(0, MAX_REASON_LENGTH) }));
    const plan = { warningIssuedAt: args.warningIssuedAt, model: args.model, ranked, plannedAt: Date.now() };
    const existing = await planFor(ctx, args.warningIssuedAt);
    if (existing) await ctx.db.replace("callPlans", existing._id, plan);
    else await ctx.db.insert("callPlans", plan);
    return null;
  },
});
