import { v } from "convex/values";
import { internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { applyRecordPatch, nextToCall } from "./households";
import { endCall, resolveFollowUpFor, startCall } from "./calls";
import { scriptFor } from "./scripts";
import { callPriorityFor, located, metersBetween, Point } from "./model";
import { approveLeftovers, standInCallbacks, standInDispatch } from "./dispatchStandIn";

// Stand-ins. Each block below fakes one teammate's service so the whole pipeline runs
// before the real piece exists. Flip its switch in `control` once the real one writes.

export const TICK_MS = 900;
const RING_MS = 1800;
const RETRY_AFTER_MS = 20_000;
const TEXT_REPLY_WAIT_MS = 25_000;
const MAX_NEW_CALLS_PER_TICK = 2;
const INBOUND_CHANCE_PER_TICK = 0.15;
const LINE_CHANCE_PER_TICK = 0.7;

async function personaFor(ctx: MutationCtx, household: Doc<"households">) {
  return await ctx.db
    .query("personas")
    .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
    .unique();
}

function fieldConfidence(patch: object) {
  return Object.fromEntries(Object.keys(patch).map((key) => [key, Math.round((0.78 + Math.random() * 0.21) * 100) / 100]));
}

async function activeSimulatedCalls(ctx: MutationCtx) {
  const ringing = await ctx.db.query("calls").withIndex("by_phase", (q) => q.eq("phase", "ringing")).take(100);
  const live = await ctx.db.query("calls").withIndex("by_phase", (q) => q.eq("phase", "live")).take(100);
  return [...ringing, ...live];
}

async function advanceRinging(ctx: MutationCtx, call: Doc<"calls">, persona: Doc<"personas">, now: number) {
  if (now - call.startedAt < RING_MS) return;
  const answers = call.direction === "inbound" || Math.random() < persona.answersPhone;
  if (answers) await ctx.db.patch("calls", call._id, { phase: "live" });
  else await endCall(ctx, call._id, false);
}

async function advanceLive(ctx: MutationCtx, call: Doc<"calls">, household: Doc<"households">, persona: Doc<"personas">) {
  if (Math.random() > LINE_CHANCE_PER_TICK) return;
  const spoken = await ctx.db
    .query("transcriptLines")
    .withIndex("by_callId", (q) => q.eq("callId", call._id))
    .take(50);
  const script = scriptFor(household.address, household.language, persona.truth);
  const step = script[spoken.length];
  if (!step) {
    await endCall(ctx, call._id, true);
    return;
  }
  await ctx.db.insert("transcriptLines", { callId: call._id, speaker: step.speaker, text: step.text, at: Date.now() });
  await ctx.db.patch("calls", call._id, { stage: step.stage });
  if (step.patch) await applyRecordPatch(ctx, household._id, step.patch, fieldConfidence(step.patch));
}

async function standInVoiceAgent(ctx: MutationCtx, now: number) {
  for (const call of await activeSimulatedCalls(ctx)) {
    if (!call.simulated) continue;
    const household = await ctx.db.get("households", call.householdId);
    const persona = household && (await personaFor(ctx, household));
    if (!household || !persona) continue;
    if (call.phase === "ringing") await advanceRinging(ctx, call, persona, now);
    else await advanceLive(ctx, call, household, persona);
  }
}

function readyToDial(household: Doc<"households">, now: number) {
  if (!household.simulated || !household.inZone) return false;
  if (household.callStatus === "not_called") return true;
  return now - (household.lastAttemptAt ?? 0) > RETRY_AFTER_MS;
}

async function standInDialer(ctx: MutationCtx, control: Doc<"control">, now: number) {
  const active = (await activeSimulatedCalls(ctx)).length;
  let slots = Math.min(control.maxConcurrentCalls - active, MAX_NEW_CALLS_PER_TICK);
  if (slots <= 0) return;

  if (Math.random() < INBOUND_CHANCE_PER_TICK) {
    const waiting = await ctx.db
      .query("households")
      .withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", "not_called"))
      .take(200);
    const caller = waiting[Math.floor(Math.random() * waiting.length)];
    if (caller?.simulated && caller.inZone) {
      await startCall(ctx, { householdId: caller._id, direction: "inbound", simulated: true });
      slots -= 1;
    }
  }

  const candidates = (await nextToCall(ctx, 40)).filter((h) => readyToDial(h, now)).slice(0, slots);
  for (const household of candidates) {
    await startCall(ctx, { householdId: household._id, direction: "outbound", simulated: true });
  }
}

const TEXT_PROMPT = "Altadena evacuation line: reply 1 if you can leave on your own, 2 if you need a ride, 3 if you need a wheelchair-accessible vehicle.";

async function ensureTextSent(ctx: MutationCtx, household: Doc<"households">) {
  const sent = await ctx.db.query("texts").withIndex("by_householdId", (q) => q.eq("householdId", household._id)).first();
  if (!sent) await ctx.db.insert("texts", { householdId: household._id, direction: "outbound", body: TEXT_PROMPT, at: Date.now() });
}

const replyDigit = (truth: Doc<"personas">["truth"]) =>
  truth.mobility !== "walks" ? "3" : truth.canLeave === "yes" && truth.hasCar ? "1" : "2";

async function standInTextFollowUp(ctx: MutationCtx, now: number) {
  const texted = await ctx.db.query("households").withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", "texted")).take(50);
  for (const household of texted) {
    if (!household.simulated) continue;
    await ensureTextSent(ctx, household);
    if (now - (household.lastAttemptAt ?? now) < TEXT_REPLY_WAIT_MS) continue;
    const persona = await personaFor(ctx, household);
    if (!persona) continue;
    if (persona.repliesToText) {
      await ctx.db.insert("texts", { householdId: household._id, direction: "inbound", body: replyDigit(persona.truth), at: now });
      const { truth } = persona;
      const patch = { canLeave: truth.canLeave, mobility: truth.mobility, medical: truth.medical, hasCar: truth.hasCar };
      await applyRecordPatch(ctx, household._id, patch, fieldConfidence(patch));
    }
    await resolveFollowUpFor(ctx, household._id, persona.repliesToText ? "replied" : "door_check");
  }
}

// Stand-in need model: census prior, shrunk toward what nearby answered calls revealed.
const NEIGHBOR_RADIUS_METERS = 350;
const PRIOR_STRENGTH = 3;
const RAISE_EVENT_THRESHOLD = 0.5;
const MAX_MODEL_EVENTS_PER_TICK = 2;

const NEEDS_HELP = new Set(["needs_ride", "needs_accessible"]);

function posteriorFor(household: Doc<"households"> & Point, reached: (Doc<"households"> & Point)[]) {
  let neighbors = 0;
  let needing = 0;
  for (const other of reached) {
    if (metersBetween(household, other) > NEIGHBOR_RADIUS_METERS) continue;
    neighbors += 1;
    if (NEEDS_HELP.has(other.outcome)) needing += 1;
  }
  return (household.needPrior * PRIOR_STRENGTH + needing) / (PRIOR_STRENGTH + neighbors);
}

async function standInNeedModel(ctx: MutationCtx, now: number) {
  const households = (await ctx.db.query("households").take(1000)).filter(located);
  const reached = households.filter((h) => h.outcome !== "unknown" && h.outcome !== "unreachable");
  let events = 0;
  for (const household of households) {
    if (household.outcome !== "unknown") continue;
    const needProbability = posteriorFor(household, reached);
    if (Math.abs(needProbability - household.needProbability) < 0.02) continue;
    await ctx.db.patch("households", household._id, {
      needProbability,
      callPriority: callPriorityFor(needProbability, household.fireArrivalAt, now),
    });
    const crossedUp = household.needProbability < RAISE_EVENT_THRESHOLD && needProbability >= RAISE_EVENT_THRESHOLD;
    if (crossedUp && events < MAX_MODEL_EVENTS_PER_TICK) {
      events += 1;
      await ctx.db.insert("events", {
        kind: "model",
        message: `${household.address} moved up the call list: neighbors need help (${household.needProbability.toFixed(2)} to ${needProbability.toFixed(2)})`,
        householdId: household._id,
        at: now,
      });
    }
  }
}

export const tick = internalMutation({
  args: { generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { generation }) => {
    const control = await ctx.db.query("control").first();
    if (!control || control.tickGeneration !== generation || !control.warningIssuedAt) return null;
    const now = Date.now();
    if (control.simulateVoice) {
      await standInVoiceAgent(ctx, now);
      if (control.dialerRunning) await standInDialer(ctx, control, now);
      await standInTextFollowUp(ctx, now);
    }
    if (control.simulateVoice) await standInCallbacks(ctx, now);
    if (control.simulateNeedModel) await standInNeedModel(ctx, now);
    if (control.autoApprove) await approveLeftovers(ctx);
    if (control.simulateDispatch) await standInDispatch(ctx, control, now, TICK_MS);
    else await ctx.scheduler.runAfter(0, internal.fleet.tick, { tickMs: TICK_MS });
    await ctx.scheduler.runAfter(TICK_MS, internal.sim.tick, { generation });
    return null;
  },
});
