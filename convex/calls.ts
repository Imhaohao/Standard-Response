import { v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Id } from "./_generated/dataModel";
import { callPhase, callStage, requestStatus } from "./schema";
import { outcomeFor } from "./model";

const MAX_VOICE_ATTEMPTS = 2;

export async function startCall(
  ctx: MutationCtx,
  args: { householdId: Id<"households">; direction: "inbound" | "outbound"; simulated: boolean },
) {
  const household = await ctx.db.get("households", args.householdId);
  if (!household) throw new Error(`Household ${args.householdId} not found`);
  const now = Date.now();
  await ctx.db.patch("households", household._id, {
    callStatus: "in_call",
    attempts: household.attempts + 1,
    lastAttemptAt: now,
  });
  return await ctx.db.insert("calls", {
    householdId: household._id,
    direction: args.direction,
    phase: "ringing",
    stage: "greet",
    language: household.language,
    attempt: household.attempts + 1,
    startedAt: now,
    simulated: args.simulated,
  });
}

export async function endCall(ctx: MutationCtx, callId: Id<"calls">, answered: boolean) {
  const call = await ctx.db.get("calls", callId);
  if (!call) throw new Error(`Call ${callId} not found`);
  const household = await ctx.db.get("households", call.householdId);
  if (!household) throw new Error(`Household ${call.householdId} not found`);
  const now = Date.now();
  await ctx.db.patch("calls", callId, { phase: answered ? "ended" : "no_answer", endedAt: now });

  // A call nobody could understand is not an answer: the home goes to the door-check queue.
  if (answered && household.escalation === "language_barrier") {
    await ctx.db.patch("households", household._id, { callStatus: "door_check" });
    await ctx.db.insert("events", {
      kind: "retry",
      message: `Couldn't understand each other at ${household.address}. Door check and an interpreter call-back`,
      householdId: household._id,
      at: now,
    });
    return;
  }
  if (answered) {
    await ctx.db.patch("households", household._id, { callStatus: "complete" });
    return;
  }
  const exhausted = household.attempts >= MAX_VOICE_ATTEMPTS;
  await ctx.db.patch("households", household._id, { callStatus: exhausted ? "texted" : "no_answer" });
  await ctx.db.insert("events", {
    kind: "retry",
    message: exhausted
      ? `No answer twice at ${household.address}. Sent a text with numbered replies`
      : `No answer at ${household.address}. Will retry`,
    householdId: household._id,
    at: now,
  });
}

// Voice server: a call connected (outbound) or arrived (inbound).
export const start = mutation({
  args: { householdId: v.id("households"), direction: v.union(v.literal("inbound"), v.literal("outbound")) },
  returns: v.id("calls"),
  handler: async (ctx, args) => {
    return await startCall(ctx, { ...args, simulated: false });
  },
});

export const setPhase = mutation({
  args: { callId: v.id("calls"), phase: callPhase },
  returns: v.null(),
  handler: async (ctx, { callId, phase }) => {
    await ctx.db.patch("calls", callId, { phase });
    return null;
  },
});

// Voice server: the conversation state machine moved to a new step.
export const setStage = mutation({
  args: { callId: v.id("calls"), stage: callStage },
  returns: v.null(),
  handler: async (ctx, { callId, stage }) => {
    await ctx.db.patch("calls", callId, { stage, phase: "live" });
    return null;
  },
});

// Voice server: one finalized utterance from either side. Agent lines carry the request status
// they were spoken under (the honesty grader reads it) and the turn latency.
export const say = mutation({
  args: {
    callId: v.id("calls"),
    speaker: v.union(v.literal("agent"), v.literal("resident")),
    text: v.string(),
    requestStatus: v.optional(requestStatus),
    latencyMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("transcriptLines", { ...args, at: Date.now() });
    return null;
  },
});

// Voice server: hang up. `answered: false` runs the retry ladder (retry, then text).
export const end = mutation({
  args: { callId: v.id("calls"), answered: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { callId, answered }) => {
    await endCall(ctx, callId, answered);
    return null;
  },
});

// Text handler: a resident replied, or nobody did and the home goes on the door-check list.
export const resolveFollowUp = mutation({
  args: { householdId: v.id("households"), result: v.union(v.literal("replied"), v.literal("door_check")) },
  returns: v.null(),
  handler: async (ctx, { householdId, result }) => {
    await resolveFollowUpFor(ctx, householdId, result);
    return null;
  },
});

export async function resolveFollowUpFor(
  ctx: MutationCtx,
  householdId: Id<"households">,
  result: "replied" | "door_check",
) {
  const household = await ctx.db.get("households", householdId);
  if (!household) throw new Error(`Household ${householdId} not found`);
  const callStatus = result === "replied" ? "complete" : "door_check";
  await ctx.db.patch("households", householdId, {
    callStatus,
    outcome: outcomeFor({ ...household, callStatus }),
  });
  await ctx.db.insert("events", {
    kind: "retry",
    message:
      result === "replied"
        ? `Text reply from ${household.address} parsed into the record`
        : `${household.address} added to the door-check list for field teams`,
    householdId,
    at: Date.now(),
  });
}

const ACTIVE_PHASES = ["ringing", "live"] as const;

export const active = query({
  args: {},
  handler: async (ctx) => {
    const calls = (
      await Promise.all(
        ACTIVE_PHASES.map((phase) => ctx.db.query("calls").withIndex("by_phase", (q) => q.eq("phase", phase)).take(50)),
      )
    ).flat();
    return await Promise.all(
      calls.map(async (call) => {
        const household = await ctx.db.get("households", call.householdId);
        const lastLine = await ctx.db
          .query("transcriptLines")
          .withIndex("by_callId", (q) => q.eq("callId", call._id))
          .order("desc")
          .first();
        return {
          ...call,
          address: household?.address ?? "Unknown address",
          lastLine: lastLine ? { speaker: lastLine.speaker, text: lastLine.text, at: lastLine.at } : null,
        };
      }),
    );
  },
});

export const detail = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get("calls", callId);
    if (!call) return null;
    const household = await ctx.db.get("households", call.householdId);
    const lines = await ctx.db
      .query("transcriptLines")
      .withIndex("by_callId", (q) => q.eq("callId", callId))
      .take(200);
    return { call, household, lines };
  },
});
