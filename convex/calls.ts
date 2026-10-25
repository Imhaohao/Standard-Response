import { Infer, v } from "convex/values";
import { query, MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { callFlow, callPhase, callStage, requestStatus } from "./schema";
import { attemptsOf } from "./pickups";
import { outcomeFor } from "./model";
import { simNow } from "./clock";
import { ladderOnDial, recordMiss, STAND_IN_MAX_VOICE_ATTEMPTS, stopLadder } from "./reachLadder";
import { clearNeighborCalls } from "./neighborCalls";

export async function startCall(
  ctx: MutationCtx,
  args: { householdId: Id<"households">; direction: "inbound" | "outbound"; simulated: boolean },
) {
  const household = await ctx.db.get("households", args.householdId);
  if (!household) throw new Error(`Household ${args.householdId} not found`);
  const now = await simNow(ctx);
  await ctx.db.patch("households", household._id, {
    callStatus: "in_call",
    attempts: household.attempts + 1,
    lastAttemptAt: now,
    ...ladderOnDial(household, now),
  });
  await clearNeighborCalls(ctx, household._id);
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
  const now = await simNow(ctx);
  await ctx.db.patch("calls", callId, { phase: answered ? "ended" : "no_answer", endedAt: now });
  const household = await ctx.db.get("households", call.householdId);
  if (!household) throw new Error(`Household ${call.householdId} not found`);
  // A pickup or Ready call reports its own result; the home's warning call and retries are untouched.
  if (call.flow) return await logCallEnd(ctx, call, household, answered, now);
  // A simulated call always changes the record, which logs it; a real one may not.
  if (answered && !call.simulated) await logCallEnd(ctx, call, household, answered, now);
  if (answered) return await endAnswered(ctx, household, now);
  // Real riders: the reach ladder workflow owns the retries, the text and the door check.
  if (!household.simulated) return await recordMiss(ctx, household, now);
  await endUnansweredStandIn(ctx, household, now);
}

// The activity row that opens a call that may have written nothing else there.
async function logCallEnd(ctx: MutationCtx, call: Doc<"calls">, household: Doc<"households">, answered: boolean, now: number) {
  const purpose = !call.flow ? "Warning" : call.flow.kind === "ready" ? "Ready check" : "Pickup check";
  await ctx.db.insert("events", {
    kind: "call",
    message: answered ? `${purpose} call with ${household.address} ended` : `${purpose}: no answer at ${household.address}`,
    householdId: household._id,
    callId: call._id,
    at: now,
  });
}

async function endAnswered(ctx: MutationCtx, household: Doc<"households">, now: number) {
  // A call nobody could understand is not an answer: the home goes to the door-check queue.
  if (household.escalation === "language_barrier") {
    await ctx.db.patch("households", household._id, { callStatus: "door_check" });
    await stopLadder(ctx, household._id, "door_check");
    await ctx.db.insert("events", {
      kind: "retry",
      message: `Couldn't understand each other at ${household.address}. Door check and an interpreter call-back`,
      householdId: household._id,
      at: now,
    });
    return;
  }
  await ctx.db.patch("households", household._id, { callStatus: "complete" });
  await stopLadder(ctx, household._id, "reached");
}

// Simulated households keep the stand-in's fast ladder: two calls, then a text (sim.ts).
async function endUnansweredStandIn(ctx: MutationCtx, household: Doc<"households">, now: number) {
  const exhausted = household.attempts >= STAND_IN_MAX_VOICE_ATTEMPTS;
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

async function flowAttempt(ctx: MutationCtx, household: Doc<"households">, flow: Infer<typeof callFlow>) {
  if (flow.kind === "ready") return (household.readyMisses ?? 0) + 1;
  const plan = await ctx.db.get("pickupPlans", flow.planId);
  return plan ? attemptsOf(plan, flow.role, flow.purpose) : 1;
}

// A pickup-check or Ready-check call. It goes on the call floor with the home it's about (for a
// pickup, the home being picked up) but isn't an attempt at its warning call.
export async function startFlowCall(
  ctx: MutationCtx,
  household: Doc<"households">,
  flow: Infer<typeof callFlow>,
  { simulated, phase }: { simulated: boolean; phase: "ringing" | "live" },
) {
  return await ctx.db.insert("calls", {
    householdId: household._id,
    direction: "outbound",
    phase,
    stage: "greet",
    language: household.language,
    attempt: await flowAttempt(ctx, household, flow),
    startedAt: await simNow(ctx),
    simulated,
    flow,
  });
}

// Voice server: a pickup-check or Ready-check call connected.
export const startFlow = mutation({
  args: { householdId: v.id("households"), flow: callFlow },
  returns: v.id("calls"),
  handler: async (ctx, { householdId, flow }) => {
    const household = await ctx.db.get("households", householdId);
    if (!household) throw new Error(`Household ${householdId} not found`);
    return await startFlowCall(ctx, household, flow, { simulated: false, phase: "live" });
  },
});

const ACTIVE_PHASES = ["ringing", "live"] as const;

// Call floor: hang up a call from our side. A simulated call ends here. A real one is hung up by the
// voice server, which watches `hangUpRequests` and ends it through Twilio, ringing or live.
export const requestHangUp = mutation({
  args: { callId: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get("calls", callId);
    if (!call || call.endedAt !== undefined) return null;
    if (call.simulated) await endCall(ctx, callId, true);
    else await ctx.db.patch("calls", callId, { hangUpRequestedAt: Date.now() });
    return null;
  },
});

// Voice server: real calls the call floor asked to hang up that haven't ended yet.
export const hangUpRequests = query({
  args: {},
  returns: v.array(v.id("calls")),
  handler: async (ctx) => {
    const calls = (
      await Promise.all(ACTIVE_PHASES.map((phase) => ctx.db.query("calls").withIndex("by_phase", (q) => q.eq("phase", phase)).take(100)))
    ).flat();
    return calls.filter((call) => !call.simulated && call.hangUpRequestedAt !== undefined).map((call) => call._id);
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

// Voice server: the conversation state machine moved to a new step. A step that lands after the
// call ended (the reply was still being worked out at hang-up) must not reopen it.
export const setStage = mutation({
  args: { callId: v.id("calls"), stage: callStage },
  returns: v.null(),
  handler: async (ctx, { callId, stage }) => {
    const call = await ctx.db.get("calls", callId);
    if (!call || call.endedAt !== undefined) return null;
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
    await ctx.db.insert("transcriptLines", { ...args, at: await simNow(ctx) });
    return null;
  },
});

// Voice server: hang up. `answered: false` moves the reach ladder on (convex/reachLadder.ts);
// `answered: true` cancels it.
export const end = mutation({
  args: { callId: v.id("calls"), answered: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { callId, answered }) => {
    await endCall(ctx, callId, answered);
    return null;
  },
});

// Voice server boot: the process before it held every real call and died without ending them, so a
// call still live from before the boot was dropped. Ringing calls are left to the carrier's status
// webhook, which still reports them; simulated calls never ran on the server.
export const endDropped = mutation({
  args: { bootedAt: v.number() },
  returns: v.number(),
  handler: async (ctx, { bootedAt }) => {
    const live = await ctx.db.query("calls").withIndex("by_phase", (q) => q.eq("phase", "live")).take(50);
    const dropped = live.filter((call) => !call.simulated && call._creationTime < bootedAt);
    for (const call of dropped) await endCall(ctx, call._id, await residentSpoke(ctx, call._id));
    return dropped.length;
  },
});

async function residentSpoke(ctx: MutationCtx, callId: Id<"calls">) {
  const lines = await ctx.db.query("transcriptLines").withIndex("by_callId", (q) => q.eq("callId", callId)).take(500);
  return lines.some((line) => line.speaker === "resident");
}

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
  await stopLadder(ctx, householdId, result === "replied" ? "replied" : "door_check");
  await ctx.db.insert("events", {
    kind: "retry",
    message:
      result === "replied"
        ? `Text reply from ${household.address} parsed into the record`
        : `${household.address} added to the door-check list for field teams`,
    householdId,
    at: await simNow(ctx),
  });
}

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

// Who is on the other end: the helper on a helper's pickup call, otherwise the home's resident.
async function speakerName(ctx: QueryCtx, call: Doc<"calls">, household: Doc<"households"> | null) {
  if (call.flow?.kind === "pickup" && call.flow.role === "helper") return (await ctx.db.get("pickupPlans", call.flow.planId))?.helperName;
  return household?.residentName;
}

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
    return { call, household, lines, speakerName: await speakerName(ctx, call, household) };
  },
});
