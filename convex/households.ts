import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { callStatus, canLeave, mobility, medicalNeed, outcome } from "./schema";
import { callPriorityFor, outcomeFor } from "./model";

const recordPatch = v.object({
  canLeave: v.optional(canLeave),
  peopleCount: v.optional(v.number()),
  mobility: v.optional(mobility),
  medical: v.optional(v.array(medicalNeed)),
  pets: v.optional(v.boolean()),
  hasCar: v.optional(v.boolean()),
  address: v.optional(v.string()),
  language: v.optional(v.string()),
});

export type RecordPatch = typeof recordPatch.type;

export async function applyRecordPatch(
  ctx: MutationCtx,
  householdId: Id<"households">,
  patch: RecordPatch,
  confidence: Record<string, number>,
) {
  const household = await ctx.db.get("households", householdId);
  if (!household) throw new Error(`Household ${householdId} not found`);
  const merged = { ...household, ...patch };
  const outcome = outcomeFor(merged);
  await ctx.db.patch("households", householdId, {
    ...patch,
    outcome,
    confidence: { ...household.confidence, ...confidence },
  });
  if (outcome !== household.outcome && outcome !== "unknown") {
    await ctx.db.insert("events", {
      kind: "record",
      message: `${household.address} marked ${outcome.replace("_", " ")}`,
      householdId,
      at: Date.now(),
    });
  }
}

// Voice agent tool call: `update_household`. Send only the fields the resident just answered.
export const update = mutation({
  args: {
    householdId: v.id("households"),
    patch: recordPatch,
    confidence: v.optional(v.record(v.string(), v.number())),
  },
  returns: v.null(),
  handler: async (ctx, { householdId, patch, confidence }) => {
    await applyRecordPatch(ctx, householdId, patch, confidence ?? {});
    return null;
  },
});

// Need model and fire model output. Send any subset of households, as often as you like.
export const setEstimates = mutation({
  args: {
    estimates: v.array(
      v.object({
        householdId: v.id("households"),
        needProbability: v.number(),
        fireArrivalAt: v.optional(v.number()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { estimates }) => {
    const now = Date.now();
    for (const estimate of estimates) {
      const household = await ctx.db.get("households", estimate.householdId);
      if (!household) continue;
      const fireArrivalAt = estimate.fireArrivalAt ?? household.fireArrivalAt;
      await ctx.db.patch("households", household._id, {
        needProbability: estimate.needProbability,
        fireArrivalAt,
        callPriority: callPriorityFor(estimate.needProbability, fireArrivalAt, now),
      });
    }
    return null;
  },
});

const QUEUE_STATUSES = ["not_called", "no_answer"] as const;

export async function nextToCall(ctx: QueryCtx, limit: number) {
  const lists = await Promise.all(
    QUEUE_STATUSES.map((callStatus) =>
      ctx.db
        .query("households")
        .withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", callStatus))
        .order("desc")
        .take(limit),
    ),
  );
  return lists
    .flat()
    .sort((a, b) => b.callPriority - a.callPriority)
    .slice(0, limit);
}

export const queue = query({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      _id: v.id("households"),
      address: v.string(),
      language: v.string(),
      needProbability: v.number(),
      fireArrivalAt: v.number(),
      attempts: v.number(),
      callStatus,
    }),
  ),
  handler: async (ctx, { limit }) => {
    const households = await nextToCall(ctx, limit);
    return households.map((h) => ({
      _id: h._id,
      address: h.address,
      language: h.language,
      needProbability: h.needProbability,
      fireArrivalAt: h.fireArrivalAt,
      attempts: h.attempts,
      callStatus: h.callStatus,
    }));
  },
});

export const coverage = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("households"),
      lat: v.number(),
      lng: v.number(),
      outcome,
      callStatus,
      needProbability: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const households = await ctx.db.query("households").take(1000);
    return households.map((h) => ({
      _id: h._id,
      lat: h.lat,
      lng: h.lng,
      outcome: h.outcome,
      callStatus: h.callStatus,
      needProbability: h.needProbability,
    }));
  },
});

type Tally<K extends string> = Record<K, number>;

function tally<K extends string>(values: K[], keys: readonly K[]): Tally<K> {
  const counts = Object.fromEntries(keys.map((k) => [k, 0])) as Tally<K>;
  for (const value of values) counts[value] += 1;
  return counts;
}

const OUTCOMES = ["unknown", "leaving", "needs_ride", "needs_accessible", "unreachable"] as const;
const STATUSES = ["not_called", "in_call", "no_answer", "texted", "door_check", "complete"] as const;

export const counts = query({
  args: {},
  returns: v.object({
    total: v.number(),
    outcome: v.record(v.string(), v.number()),
    callStatus: v.record(v.string(), v.number()),
  }),
  handler: async (ctx) => {
    const households: Doc<"households">[] = await ctx.db.query("households").take(1000);
    return {
      total: households.length,
      outcome: tally(households.map((h) => h.outcome), OUTCOMES),
      callStatus: tally(households.map((h) => h.callStatus), STATUSES),
    };
  },
});

const RIDE_OUTCOMES = ["needs_accessible", "needs_ride"] as const;

// Optimizer input (Boris): every household that has told us it needs a vehicle.
export const needingRides = query({
  args: {},
  handler: async (ctx) => {
    const lists = await Promise.all(
      RIDE_OUTCOMES.map((outcome) =>
        ctx.db.query("households").withIndex("by_outcome", (q) => q.eq("outcome", outcome)).take(1000),
      ),
    );
    return lists.flat();
  },
});
