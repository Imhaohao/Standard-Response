import { v } from "convex/values";
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

export const state = query({
  args: {},
  handler: async (ctx) => (await stateRow(ctx)) ?? DEFAULT_STATE,
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
    return {
      now: Date.now(),
      warningIssuedAt: control?.warningIssuedAt ?? null,
      zone: zone ? { polygon: zone.polygon, drawnAt: zone.drawnAt } : null,
      state: (await stateRow(ctx)) ?? DEFAULT_STATE,
      households: households.map((h) => ({
        _id: h._id,
        address: h.address,
        lat: h.lat ?? null,
        lng: h.lng ?? null,
        riderId: h.riderId ?? null,
        mobility: h.mobility ?? null,
        outcome: h.outcome,
        callStatus: h.callStatus,
        escalation: h.escalation ?? null,
        inZone: h.inZone,
        attempts: h.attempts,
        lastAttemptAt: h.lastAttemptAt ?? null,
        needPrior: h.needPrior,
        needProbability: h.needProbability,
        fireArrivalAt: h.fireArrivalAt,
        doorPriority: h.doorPriority ?? null,
        simulated: h.simulated,
      })),
      nominatedHouseholdIds: matched.flatMap((n) => (n.matchedHouseholdId ? [n.matchedHouseholdId] : [])),
      openNominations: open.map((n) => ({
        _id: n._id,
        spokenAddress: n.spokenAddress,
        fromHouseholdId: n.fromHouseholdId ?? null,
        at: n.at,
      })),
      closures: (await ctx.db.query("roadClosures").take(2000)).map((c) => ({
        edgeKey: c.edgeKey ?? null,
        path: c.path,
        source: c.source,
      })),
    };
  },
});

// Agent lines from real calls with the request status when each was spoken, for the implied-reassurance grader.
export const agentLines = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const lines = await ctx.db.query("transcriptLines").order("desc").take(Math.min(limit, 5000));
    return lines
      .filter((line) => line.speaker === "agent")
      .map((line) => ({ _id: line._id, text: line.text, requestStatus: line.requestStatus ?? null, at: line.at }));
  },
});
