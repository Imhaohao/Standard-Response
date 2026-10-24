import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";

// Track D's model runner (modeling/scripts/run_models.py) reads its inputs here and reports back.
// It never reads `personas`: the models see only what a real agency would know.

const DEFAULT_STATE = { smoothing: true };

async function stateRow(ctx: QueryCtx) {
  return await ctx.db.query("modelState").first();
}

async function ensureState(ctx: MutationCtx) {
  const existing = await stateRow(ctx);
  if (existing) return existing;
  const id = await ctx.db.insert("modelState", DEFAULT_STATE);
  return (await ctx.db.get("modelState", id))!;
}

// The runner passes every ~5 s. Once its last pass is older than this, the need-model stand-in covers
// for it, so stopping the runner (or a `--once` pass) never leaves the incident without a need model.
export const RUNNER_STALE_MS = 15_000;

export async function needModelRunnerLive(ctx: QueryCtx, now: number) {
  const lastRunAt = (await stateRow(ctx))?.lastRunAt;
  return lastRunAt !== undefined && now - lastRunAt < RUNNER_STALE_MS;
}

export const state = query({
  args: {},
  returns: v.object({
    smoothing: v.boolean(),
    doorAlpha: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
    stats: v.optional(v.record(v.string(), v.number())),
  }),
  handler: async (ctx) => {
    const row = await stateRow(ctx);
    return { smoothing: row?.smoothing ?? DEFAULT_STATE.smoothing, doorAlpha: row?.doorAlpha, lastRunAt: row?.lastRunAt, stats: row?.stats };
  },
});

// The on-screen toggle for spatial smoothing of need estimates. The runner picks it up on its next pass.
export const setSmoothing = mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { enabled }) => {
    const row = await ensureState(ctx);
    await ctx.db.patch("modelState", row._id, { smoothing: enabled });
    await ctx.db.insert("events", {
      kind: "model",
      message: enabled ? "Need model: neighbor smoothing on" : "Need model: neighbor smoothing off (census and known needs only)",
      at: Date.now(),
    });
    return null;
  },
});

export const reportRun = mutation({
  args: {
    stats: v.record(v.string(), v.number()),
    doorAlpha: v.optional(v.number()),
    incidentKey: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ensureState(ctx);
    await ctx.db.patch("modelState", row._id, { ...args, lastRunAt: Date.now() });
    return null;
  },
});

const HOUSEHOLD_LIMIT = 5000;

// Python reads these payloads, so an absent field is written as null rather than left out.
const orNull = <T>(value: T | undefined): T | null => value ?? null;

const toHouseholdInput = (h: Doc<"households">) => ({
  _id: h._id,
  address: h.address,
  lat: orNull(h.lat),
  lng: orNull(h.lng),
  riderId: orNull(h.riderId),
  mobility: orNull(h.mobility),
  outcome: h.outcome,
  callStatus: h.callStatus,
  escalation: orNull(h.escalation),
  inZone: h.inZone,
  attempts: h.attempts,
  lastAttemptAt: orNull(h.lastAttemptAt),
  needPrior: h.needPrior,
  needProbability: h.needProbability,
  fireArrivalAt: h.fireArrivalAt,
  doorPriority: orNull(h.doorPriority),
  simulated: h.simulated,
});

const toNominationInput = (n: Doc<"nominations">) => ({
  _id: n._id,
  spokenAddress: n.spokenAddress,
  fromHouseholdId: orNull(n.fromHouseholdId),
  at: n.at,
});

const toClosureInput = (c: Doc<"roadClosures">) => ({ edgeKey: orNull(c.edgeKey), path: c.path, source: c.source });

const matchedHouseholdIds = (matched: Doc<"nominations">[]) =>
  matched.flatMap((n) => (n.matchedHouseholdId ? [n.matchedHouseholdId] : []));

const zoneInput = (zone: Doc<"zones"> | null) => (zone ? { polygon: zone.polygon, drawnAt: zone.drawnAt } : null);

// Everything the hazard runner, need model, door-check score and address matcher need, in one read.
export const inputs = query({
  args: {},
  handler: async (ctx) => {
    const control = await ctx.db.query("control").first();
    const zone = await ctx.db.query("zones").order("desc").first();
    const households = await ctx.db.query("households").take(HOUSEHOLD_LIMIT);
    const matched = await ctx.db
      .query("nominations")
      .withIndex("by_status", (q) => q.eq("status", "matched"))
      .take(1000);
    const open = await ctx.db
      .query("nominations")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(200);
    const closures = await ctx.db.query("roadClosures").take(2000);
    return {
      now: Date.now(),
      warningIssuedAt: orNull(control?.warningIssuedAt),
      zone: zoneInput(zone),
      state: (await stateRow(ctx)) ?? DEFAULT_STATE,
      households: households.map(toHouseholdInput),
      nominatedHouseholdIds: matchedHouseholdIds(matched),
      openNominations: open.map(toNominationInput),
      closures: closures.map(toClosureInput),
    };
  },
});

// Agent lines from real calls with the request status when each was spoken, for the implied-reassurance grader.
// Lines from simulated calls are the stand-in's script, not the voice agent, so they're left out.
export const agentLines = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const lines = await ctx.db.query("transcriptLines").order("desc").take(Math.min(limit, 5000));
    const simulated = new Map<string, boolean>();
    const out = [];
    for (const line of lines) {
      if (line.speaker !== "agent") continue;
      if (!simulated.has(line.callId)) simulated.set(line.callId, (await ctx.db.get("calls", line.callId))?.simulated ?? true);
      if (simulated.get(line.callId)) continue;
      out.push({ _id: line._id, text: line.text, requestStatus: line.requestStatus ?? null, at: line.at });
    }
    return out;
  },
});
