import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { simNow } from "./clock";
import { controlRow } from "./control";
import { internalMutation, mutation } from "./functions";
import {
  Counts,
  PHASES,
  Phase,
  purgeHouseholdBatch,
  realRiderDataExists,
  scrubCallPlans,
  scrubPage,
} from "./incidentPurge";

// "Real rider data is deleted when the incident closes" (PLAN.md, Responsible design). Closing the
// incident starts a retention clock; when it runs out `purge` deletes real riders' data, and a daily
// cron (convex/crons.ts) catches a purge that never ran. What goes and what stays: convex/incidentPurge.ts.

const DEFAULT_RETENTION_HOURS = 72;
const HOUR_MS = 3_600_000;

export function retentionMs() {
  const hours = Number(process.env.INCIDENT_RETENTION_HOURS ?? DEFAULT_RETENTION_HOURS);
  return (Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_RETENTION_HOURS) * HOUR_MS;
}

type PurgeId = NonNullable<Doc<"control">["incidentPurgeId"]>;

async function logIncident(ctx: MutationCtx, message: string) {
  await ctx.db.insert("events", { kind: "control", message, at: await simNow(ctx) });
}

export const close = mutation({
  args: {},
  returns: v.object({ closedAt: v.number(), purgeAt: v.number() }),
  handler: async (ctx) => {
    const control = await controlRow(ctx);
    if (control.incidentClosedAt !== undefined) {
      return { closedAt: control.incidentClosedAt, purgeAt: control.incidentClosedAt + retentionMs() };
    }
    const closedAt = Date.now();
    const delay = retentionMs();
    const incidentPurgeId = await ctx.scheduler.runAfter(delay, internal.incident.purge, {});
    await ctx.db.patch("control", control._id, { incidentClosedAt: closedAt, incidentPurgeId, incidentPurgedAt: undefined });
    await logIncident(ctx, `Incident closed: rider data will be deleted at ${new Date(closedAt + delay).toISOString()}`);
    return { closedAt, purgeAt: closedAt + delay };
  },
});

export const reopen = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const control = await controlRow(ctx);
    if (control.incidentClosedAt === undefined) return null;
    if (control.incidentPurgeId) await cancelScheduledPurge(ctx, control.incidentPurgeId);
    await ctx.db.patch("control", control._id, { incidentClosedAt: undefined, incidentPurgeId: undefined, incidentPurgedAt: undefined });
    await logIncident(ctx, "Incident reopened: the scheduled deletion of rider data was cancelled");
    return null;
  },
});

async function cancelScheduledPurge(ctx: MutationCtx, purgeId: PurgeId) {
  const scheduled = await ctx.db.system.get("_scheduled_functions", purgeId);
  if (scheduled?.state.kind === "pending") await ctx.scheduler.cancel(purgeId);
}

// Each phase scrubs one table, a page at a time. Households go last: the rows before them look up
// which household they belong to.
const SCRUBBED_TABLE = {
  events: "events",
  auditLog: "auditLog",
  callbacks: "callbacks",
  nominations: "nominations",
  archive: "nightRunRows",
} as const;

type ScrubPhase = keyof typeof SCRUBBED_TABLE;

type Progress = { phase: Phase; cursor: string | null; counts: Counts };
type Advanced = { finished: false; progress: Progress } | { finished: true; counts: Counts };

function nextPhase(phase: Phase): Phase | undefined {
  return PHASES[PHASES.indexOf(phase) + 1];
}

const moveOn = (progress: Progress): Advanced => ({ finished: false, progress });

async function advance(ctx: MutationCtx, { phase, cursor, counts }: Progress): Promise<Advanced> {
  if (phase === "households") {
    const result = await purgeHouseholdBatch(ctx, counts);
    return result.done ? { finished: true, counts: result.counts } : moveOn({ phase, cursor: null, counts: result.counts });
  }
  if (phase === "callPlans") return moveOn({ phase: "archive", cursor: null, counts: await scrubCallPlans(ctx, counts) });
  const page = await scrubPage(ctx, SCRUBBED_TABLE[phase as ScrubPhase], cursor, counts);
  if (!page.done) return moveOn({ phase, cursor: page.cursor, counts: page.counts });
  return moveOn({ phase: nextPhase(phase)!, cursor: null, counts: page.counts });
}

function describeCounts(counts: Counts) {
  const parts = Object.entries(counts).map(([table, count]) => `${count} ${table}`);
  return parts.length ? parts.join(", ") : "nothing";
}

async function finishPurge(ctx: MutationCtx, counts: Counts) {
  const control = await controlRow(ctx);
  await ctx.db.patch("control", control._id, { incidentPurgedAt: Date.now() });
  await logIncident(ctx, `Incident rider data deleted: ${describeCounts(counts)}`);
}

const progressArgs = {
  phase: v.optional(v.union(...PHASES.map((phase) => v.literal(phase)))),
  cursor: v.optional(v.union(v.string(), v.null())),
  counts: v.optional(v.record(v.string(), v.number())),
};

export const purge = internalMutation({
  args: progressArgs,
  returns: v.null(),
  handler: async (ctx, { phase = PHASES[0], cursor = null, counts = {} }) => {
    const control = await controlRow(ctx);
    if (control.incidentClosedAt === undefined) return null;
    const next = await advance(ctx, { phase, cursor, counts });
    if (next.finished) await finishPurge(ctx, next.counts);
    else await ctx.scheduler.runAfter(0, internal.incident.purge, next.progress);
    return null;
  },
});

// The daily safety net: the retention window ran out and real rider data is still there, so the
// scheduled purge never ran or stopped partway. Nothing to do costs one read of the control row.
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const control = await controlRow(ctx);
    if (control.incidentClosedAt === undefined) return null;
    if (Date.now() < control.incidentClosedAt + retentionMs()) return null;
    if (!(await realRiderDataExists(ctx))) return null;
    if (control.incidentPurgeId && (await purgeStillQueued(ctx, control.incidentPurgeId))) return null;
    await ctx.scheduler.runAfter(0, internal.incident.purge, {});
    return null;
  },
});

async function purgeStillQueued(ctx: MutationCtx, purgeId: PurgeId) {
  const scheduled = await ctx.db.system.get("_scheduled_functions", purgeId);
  return scheduled?.state.kind === "pending" || scheduled?.state.kind === "inProgress";
}
