import { v } from "convex/values";
import { query, MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { assistanceRequired, callStatus, canLeave, exitPlan, mobility, medicalNeed, outcome } from "./schema";
import { callPriorityFor, deadlineFor, located, outcomeFor } from "./model";
import { askNearbyDriver, askNewDriver, busyHelpers } from "./neighborPickups";
import { openRequestFor, syncRequest } from "./requests";
import { countHouseholds } from "./householdCounts";
import { simNow } from "./clock";

const recordPatch = v.object({
  canLeave: v.optional(canLeave),
  peopleCount: v.optional(v.number()),
  mobility: v.optional(mobility),
  assistanceRequired: v.optional(assistanceRequired),
  medical: v.optional(v.array(medicalNeed)),
  pets: v.optional(v.boolean()),
  hasCar: v.optional(v.boolean()),
  address: v.optional(v.string()),
  language: v.optional(v.string()),
});

export type RecordPatch = typeof recordPatch.type;

type Correction = NonNullable<Doc<"households">["corrections"]>[number];

// Inbound callers start with this placeholder. Filling it in isn't a correction.
export const UNCONFIRMED_ADDRESS = "Address not confirmed";

// A field that already had a value and now has a different one is a correction.
function correctionsBetween(household: Doc<"households">, patch: RecordPatch, at: number): Correction[] {
  return Object.entries(patch).flatMap(([field, value]) => {
    const before = household[field as keyof RecordPatch];
    if (before === undefined || before === UNCONFIRMED_ADDRESS) return [];
    if (JSON.stringify(before) === JSON.stringify(value)) return [];
    return [{ field, from: JSON.stringify(before), to: JSON.stringify(value), at }];
  });
}

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
  const corrections = correctionsBetween(household, patch, await simNow(ctx));
  await ctx.db.patch("households", householdId, {
    ...patch,
    outcome,
    confidence: { ...household.confidence, ...confidence },
    corrections: [...(household.corrections ?? []), ...corrections],
  });
  await syncRequest(ctx, householdId);
  await askNearbyDriver(ctx, householdId);
  await askNewDriver(ctx, household);
  if (outcome !== household.outcome && outcome !== "unknown") {
    await ctx.db.insert("events", {
      kind: "record",
      message: `${household.address} marked ${outcome.replace("_", " ")}`,
      householdId,
      at: await simNow(ctx),
    });
  }
}

// Voice agent tool call: `update_household`. Send only the fields the resident just answered.
// Changing a field that already had a value is logged as a correction and re-checks any open offer.
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

// Track D: need estimate and hazard arrival. Send any subset of households, as often as you like.
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
    const now = await simNow(ctx);
    for (const estimate of estimates) {
      const household = await ctx.db.get("households", estimate.householdId);
      if (!household) continue;
      const fireArrivalAt = estimate.fireArrivalAt ?? household.fireArrivalAt;
      await ctx.db.patch("households", household._id, {
        needProbability: estimate.needProbability,
        fireArrivalAt,
        callPriority: callPriorityFor(estimate.needProbability, fireArrivalAt, now),
      });
      const request = await openRequestFor(ctx, household._id);
      if (request) await ctx.db.patch("requests", request._id, { deadlineAt: deadlineFor(fireArrivalAt) });
    }
    return null;
  },
});

const QUEUE_STATUSES = ["not_called", "no_answer"] as const;

// A neighbor 911 is asking to drive someone, or who is already on the way, isn't rung for their own
// warning call at the same time: the pickup call would find the line busy.
export async function nextToCall(ctx: QueryCtx, limit: number) {
  const busy = await busyHelpers(ctx);
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
    .filter((h) => h.inZone && !busy.has(h._id))
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
      // Track A: the Ready check, for the rescue map's census panel.
      exitPlan: v.optional(exitPlan),
      readyMisses: v.number(),
      mobility: v.optional(mobility),
      assistanceRequired: v.optional(assistanceRequired),
      oxygen: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const households = await ctx.db.query("households").take(1000);
    return households.filter(located).map((h) => ({
      _id: h._id,
      lat: h.lat,
      lng: h.lng,
      outcome: h.outcome,
      callStatus: h.callStatus,
      needProbability: h.needProbability,
      exitPlan: h.ready?.exitPlan,
      readyMisses: h.readyMisses ?? 0,
      mobility: h.mobility,
      assistanceRequired: h.assistanceRequired,
      oxygen: h.medical?.includes("oxygen") ?? false,
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
    const control = await ctx.db.query("control").first();
    if (control?.householdCountsReadyAt) return await countHouseholds(ctx);
    // Before the one-time backfill, scan as before so the call floor never shows partial counts.
    const households: Doc<"households">[] = await ctx.db.query("households").take(1000);
    return {
      total: households.length,
      outcome: tally(households.map((h) => h.outcome), OUTCOMES),
      callStatus: tally(households.map((h) => h.callStatus), STATUSES),
    };
  },
});

// Voice track: an inbound caller. Unknown numbers get a household with no location until
// the address is matched; the dispatcher sees it flagged.
export const findOrCreateByPhone = mutation({
  args: { callbackNumber: v.string(), language: v.optional(v.string()) },
  returns: v.id("households"),
  handler: async (ctx, { callbackNumber, language }) => {
    const existing = await ctx.db
      .query("households")
      .withIndex("by_callbackNumber", (q) => q.eq("callbackNumber", callbackNumber))
      .first();
    if (existing) return existing._id;
    const now = await simNow(ctx);
    return await ctx.db.insert("households", {
      address: UNCONFIRMED_ADDRESS,
      callbackNumber,
      language: language ?? "en",
      callStatus: "in_call",
      outcome: "unknown",
      escalation: "address_unconfirmed",
      inZone: true,
      attempts: 0,
      needPrior: 0.5,
      needProbability: 0.5,
      fireArrivalAt: now + 60 * 60_000,
      callPriority: 0,
      simulated: false,
    });
  },
});

// Track D: an address was matched to a point (inbound callers, nominations).
export const setLocation = mutation({
  args: { householdId: v.id("households"), address: v.string(), lat: v.number(), lng: v.number() },
  returns: v.null(),
  handler: async (ctx, { householdId, ...location }) => {
    const household = await ctx.db.get("households", householdId);
    if (!household) throw new Error(`Household ${householdId} not found`);
    const escalation = household.escalation === "address_unconfirmed" ? undefined : household.escalation;
    await ctx.db.patch("households", householdId, { ...location, escalation });
    return null;
  },
});
