import { ConvexError, ObjectType, v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { assistanceRequired, bedroomFloor, bedroomSide, careNeed, exitPlan, medicalNeed, mobility } from "./schema";
import { callPriorityFor, located } from "./model";
import { fileLanguageOf } from "./languages";
import { seedSimulatedArea } from "./seed";
import { Helper, saveProfile } from "./readyProfile";
import { helperFor, profileFromPersona, readyScript } from "./readySim";
import { endCall, startFlowCall } from "./calls";
import { seededRandom } from "./roll";
import { simNow } from "./clock";
import { syncRequest } from "./requests";
import { warningCovers } from "./riders";
import { startRunIfNone } from "./nightRuns";

// The Ready check: before any disaster, every household tells us who lives there, what help they
// need getting out, where they sleep, and who has agreed to pick them up. The agent calls each
// home (Track B's `ready` call mode, or the stand-in below for simulated homes), or the household
// signs up on its phone at /ready.

const READY_TICK_MS = 700;
const HOMES_PER_TICK = 3;
const MOST_HOMES_PER_TICK = 30;
const MAX_MISSES = 2;
const UNKNOWN_NEED_PRIOR = 0.5;
const PLACEHOLDER_ARRIVAL_MINUTES = 90;

const helper = v.object({ name: v.string(), phone: v.string(), relation: v.optional(v.string()) });
const bedroom = v.object({ floor: bedroomFloor, side: v.optional(bedroomSide) });

const profileArgs = {
  residentName: v.optional(v.string()),
  peopleCount: v.optional(v.number()),
  mobility: v.optional(mobility),
  assistanceRequired: v.optional(assistanceRequired),
  medical: v.optional(v.array(medicalNeed)),
  pets: v.optional(v.boolean()),
  hasCar: v.optional(v.boolean()),
  exitPlan,
  bedroom: v.optional(bedroom),
  care: v.array(careNeed),
  note: v.optional(v.string()),
  helper: v.optional(helper),
};

type ProfileArgs = ObjectType<typeof profileArgs>;

const blankToUndefined = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

function profileFrom(args: ProfileArgs, via: "call" | "form", now: number) {
  const { exitPlan: plan, bedroom: room, care, note, helper: arranged, ...record } = args;
  const ready = { at: now, via, verified: via === "call", exitPlan: plan, bedroom: room, care, note: blankToUndefined(note) };
  return { record, ready, helper: arranged as Helper | undefined };
}

async function householdByPhone(ctx: MutationCtx, phone: string) {
  return await ctx.db
    .query("households")
    .withIndex("by_callbackNumber", (q) => q.eq("callbackNumber", phone))
    .first();
}

type Place = { phone: string; address: string; lat: number; lng: number; language: string };

async function findOrCreateHome(ctx: MutationCtx, place: Place) {
  const existing = await householdByPhone(ctx, place.phone);
  const inZone = await warningCovers(ctx, place);
  if (existing) {
    await ctx.db.patch("households", existing._id, { address: place.address, lat: place.lat, lng: place.lng, inZone });
    return existing._id;
  }
  const now = await simNow(ctx);
  const fireArrivalAt = now + PLACEHOLDER_ARRIVAL_MINUTES * 60_000;
  return await ctx.db.insert("households", {
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    callbackNumber: place.phone,
    language: fileLanguageOf(place.language),
    callStatus: "not_called",
    outcome: "unknown",
    inZone,
    attempts: 0,
    needPrior: UNKNOWN_NEED_PRIOR,
    needProbability: UNKNOWN_NEED_PRIOR,
    fireArrivalAt,
    callPriority: callPriorityFor(UNKNOWN_NEED_PRIOR, fireArrivalAt, now),
    simulated: false,
  });
}

const signUpArgs = { phone: v.string(), address: v.string(), lat: v.number(), lng: v.number(), language: v.string(), ...profileArgs };
type SignUp = ObjectType<typeof signUpArgs>;

async function signUp(ctx: MutationCtx, { phone, address, lat, lng, language, ...profile }: SignUp) {
  if (phone.trim() === "" || address.trim() === "") throw new Error("A phone number and an address are needed");
  const householdId = await findOrCreateHome(ctx, { phone: phone.trim(), address: address.trim(), lat, lng, language });
  await saveProfile(ctx, householdId, profileFrom(profile, "form", await simNow(ctx)));
  await ctx.db.insert("events", { kind: "record", message: `${address.trim()} signed up for the Ready check`, householdId, at: await simNow(ctx) });
  return householdId;
}

// /ready: a household signs itself up. It stays unverified until the agent confirms it by phone.
export const submit = mutation({
  args: signUpArgs,
  returns: v.id("households"),
  handler: async (ctx, args) => await signUp(ctx, args),
});

// Everything earlier calls learned about a home, so a test phone can start the night over.
const CALL_ANSWERS_CLEARED = {
  canLeave: undefined,
  peopleCount: undefined,
  mobility: undefined,
  assistanceRequired: undefined,
  medical: undefined,
  pets: undefined,
  hasCar: undefined,
  confidence: undefined,
  corrections: undefined,
  escalation: undefined,
  ready: undefined,
  neighborSearch: undefined,
  outcome: "unknown" as const,
  callStatus: "not_called" as const,
  attempts: 0,
  lastAttemptAt: undefined,
};

// Demo setup (npx convex run ready:reregister '{...}'): a test phone signs up again from scratch, with
// the answers from earlier test calls cleared and any ride request they opened closed.
export const reregister = internalMutation({
  args: signUpArgs,
  returns: v.id("households"),
  handler: async (ctx, args) => {
    const existing = await householdByPhone(ctx, args.phone.trim());
    if (existing) {
      await ctx.db.patch("households", existing._id, CALL_ANSWERS_CLEARED);
      await syncRequest(ctx, existing._id);
    }
    return await signUp(ctx, args);
  },
});

// Voice server: a Ready check call finished with a profile.
export const saveFromCall = mutation({
  args: { householdId: v.id("households"), ...profileArgs },
  returns: v.null(),
  handler: async (ctx, { householdId, ...profile }) => {
    await saveProfile(ctx, householdId, profileFrom(profile, "call", await simNow(ctx)));
    return null;
  },
});

// Voice server: nobody answered a Ready check call. Two misses and the home is left for a visit.
export const missed = mutation({
  args: { householdId: v.id("households") },
  returns: v.null(),
  handler: async (ctx, { householdId }) => {
    const household = await ctx.db.get("households", householdId);
    if (household) await ctx.db.patch("households", householdId, { readyMisses: (household.readyMisses ?? 0) + 1 });
    return null;
  },
});

const needsCall = (household: Doc<"households">) => !household.ready?.verified && (household.readyMisses ?? 0) < MAX_MISSES;

// Voice server: real households the Ready check still has to call, while the campaign runs.
export const queue = query({
  args: {},
  handler: async (ctx) => {
    const control = await ctx.db.query("control").first();
    if (!control?.readyCheckRunning || control.warningIssuedAt) return [];
    const households = await ctx.db.query("households").take(1000);
    return households
      .filter((household) => !household.simulated && needsCall(household))
      .map((household) => ({
        _id: household._id,
        callbackNumber: household.callbackNumber,
        language: household.language,
        address: household.address,
        residentName: household.residentName,
        readyMisses: household.readyMisses ?? 0,
        ready: household.ready,
      }));
  },
});

// Voice server: who already agreed to pick this home up, so its Ready call confirms them instead of
// asking from scratch. Only an arrangement for a future night; one being checked tonight is left alone.
export const helperOnFile = query({
  args: { householdId: v.id("households") },
  returns: v.union(v.null(), helper),
  handler: async (ctx, { householdId }) => {
    const plans = await ctx.db
      .query("pickupPlans")
      .withIndex("by_householdId", (q) => q.eq("householdId", householdId))
      .take(10);
    const arranged = plans.find((plan) => plan.status === "arranged");
    return arranged ? { name: arranged.helperName, phone: arranged.helperPhone, relation: arranged.relation } : null;
  },
});

// Rescue map: everything a crew should know before going in, for one home.
export const card = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    const household = await ctx.db.get("households", householdId);
    if (!household) return null;
    const plans = await ctx.db
      .query("pickupPlans")
      .withIndex("by_householdId", (q) => q.eq("householdId", householdId))
      .take(10);
    const plan = plans.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    return {
      _id: household._id,
      address: household.address,
      residentName: household.residentName,
      peopleCount: household.peopleCount,
      mobility: household.mobility,
      assistanceRequired: household.assistanceRequired,
      medical: household.medical,
      pets: household.pets,
      hasCar: household.hasCar,
      language: household.language,
      outcome: household.outcome,
      callStatus: household.callStatus,
      escalation: household.escalation,
      ready: household.ready,
      readyMisses: household.readyMisses ?? 0,
      simulated: household.simulated,
      pickup: plan && { status: plan.status, reason: plan.reason, helperName: plan.helperName, relation: plan.relation, helperEtaAt: plan.helperEtaAt },
    };
  },
});

async function controlRow(ctx: MutationCtx) {
  const control = await ctx.db.query("control").first();
  if (!control) throw new Error("Reset the demo first");
  return control;
}

// Starts the Ready check. On an empty deployment it seeds the simulated town first, so the census
// runs before any warning; `control:issueWarning` re-times those homes when the night starts.
export const start = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const control = await controlRow(ctx);
    if (control.warningIssuedAt) throw new Error("The Ready check runs before a warning. Rewind first");
    if (control.archivingRunId) throw new ConvexError("The last night is still being saved. Try again in a moment");
    const now = await simNow(ctx);
    if (!(await ctx.db.query("households").first())) await seedSimulatedArea(ctx, now);
    // Before any Ready call changes a home: this is what a rewind puts back.
    await startRunIfNone(ctx);
    const readyCheckGeneration = (control.readyCheckGeneration ?? 0) + 1;
    await ctx.db.patch("control", control._id, { readyCheckRunning: true, readyCheckStartedAt: now, readyCheckGeneration });
    await ctx.db.insert("events", { kind: "control", message: "Ready check started: calling every household ahead of time", at: now });
    await ctx.scheduler.runAfter(READY_TICK_MS, internal.ready.tick, { generation: readyCheckGeneration });
    return null;
  },
});

export const stop = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const control = await controlRow(ctx);
    await ctx.db.patch("control", control._id, { readyCheckRunning: false, readyCheckGeneration: (control.readyCheckGeneration ?? 0) + 1 });
    await hangUpStandInReadyCalls(ctx);
    return null;
  },
});

// People pick up more readily on a calm afternoon than in the middle of an evacuation.
const READY_ANSWER_BOOST = 0.15;
// Each stand-in Ready call says this many lines a tick at normal speed, so it shows on the call floor as it happens.
const READY_LINES_PER_TICK = 2;
const READY_FLOW = { kind: "ready" } as const;

type Located = Doc<"households"> & { lat: number; lng: number };

async function personaOf(ctx: MutationCtx, household: Doc<"households">) {
  return await ctx.db
    .query("personas")
    .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
    .unique();
}

// Every draw for one attempt at one home comes from its own seed, so each tick of a call rebuilds the
// same answers: first whether they pick up, then the profile, then who would pick them up.
async function readyAnswers(ctx: MutationCtx, household: Doc<"households">, persona: Doc<"personas">, nearby: Located[], now: number) {
  const random = seededRandom(`${household._id}:${household.readyMisses ?? 0}`);
  const answers = random() <= persona.answersPhone + READY_ANSWER_BOOST;
  const profile = profileFromPersona(persona, random, now);
  const helper = profile.ready.exitPlan === "helper" && located(household) ? await helperFor(ctx, household, nearby, random) : undefined;
  return { answers, profile, helper, script: readyScript(household, persona, profile, helper) };
}

// The simulated Ready calls on the line now.
async function standInReadyCalls(ctx: MutationCtx) {
  const phases = await Promise.all(
    (["ringing", "live"] as const).map((phase) => ctx.db.query("calls").withIndex("by_phase", (q) => q.eq("phase", phase)).take(100)),
  );
  return phases.flat().filter((call) => call.simulated && call.flow?.kind === "ready");
}

async function ringReadyCall(ctx: MutationCtx, call: Doc<"calls">, household: Doc<"households">, answers: boolean) {
  if (answers) return await ctx.db.patch("calls", call._id, { phase: "live" });
  await ctx.db.patch("households", household._id, { readyMisses: (household.readyMisses ?? 0) + 1 });
  await endCall(ctx, call._id, false);
}

async function advanceReadyCall(ctx: MutationCtx, call: Doc<"calls">, household: Doc<"households">, nearby: Located[], speed: number) {
  const persona = await personaOf(ctx, household);
  // Without a persona card there's nobody to answer: it counts as a miss, so the check still finishes.
  if (!persona) return await ringReadyCall(ctx, call, household, false);
  const now = await simNow(ctx);
  const { answers, profile, helper, script } = await readyAnswers(ctx, household, persona, nearby, now);
  if (call.phase === "ringing") return await ringReadyCall(ctx, call, household, answers);
  const spoken = await ctx.db
    .query("transcriptLines")
    .withIndex("by_callId", (q) => q.eq("callId", call._id))
    .take(50);
  const lines = READY_LINES_PER_TICK * speed;
  for (const step of script.slice(spoken.length, spoken.length + lines)) {
    await ctx.db.insert("transcriptLines", { callId: call._id, speaker: step.speaker, text: step.text, at: now });
    await ctx.db.patch("calls", call._id, { stage: step.stage });
    if (step.fields) await ctx.db.patch("households", household._id, step.fields);
  }
  if (spoken.length + lines < script.length) return;
  await saveProfile(ctx, household._id, { ...profile, helper });
  await endCall(ctx, call._id, true);
}

// A stand-in call cut off by a pause or the warning ends where it is; the home stays on the list.
export async function hangUpStandInReadyCalls(ctx: MutationCtx) {
  for (const call of await standInReadyCalls(ctx)) await endCall(ctx, call._id, call.phase === "live");
}

async function dialReadyCalls(ctx: MutationCtx, control: Doc<"control">, waiting: Doc<"households">[], onLine: number, speed: number) {
  const slots = Math.min(control.maxConcurrentCalls - onLine, HOMES_PER_TICK * speed, MOST_HOMES_PER_TICK);
  for (const household of waiting.slice(0, Math.max(0, slots))) {
    await startFlowCall(ctx, household, READY_FLOW, { simulated: true, phase: "ringing" });
  }
}

async function finish(ctx: MutationCtx, control: Doc<"control">, households: Doc<"households">[]) {
  const profiled = households.filter((household) => household.ready).length;
  await ctx.db.patch("control", control._id, { readyCheckRunning: false });
  await ctx.db.insert("events", { kind: "control", message: `Ready check finished: ${profiled} of ${households.length} homes on file`, at: await simNow(ctx) });
}

// One step of the stand-in campaign: a few simulated homes "answer" per tick, so the map fills in.
export const tick = internalMutation({
  args: { generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { generation }) => {
    const control = await ctx.db.query("control").first();
    if (!control?.readyCheckRunning || control.readyCheckGeneration !== generation || control.warningIssuedAt) return null;
    const speed = control.clock?.speed ?? 1;
    if (speed === 0) return null;
    const households = await ctx.db.query("households").take(1000);
    const onLine = await standInReadyCalls(ctx);
    const inCall = new Set(onLine.map((call) => call.householdId));
    const simulatedWaiting = control.simulateVoice
      ? households.filter((household) => household.simulated && needsCall(household) && !inCall.has(household._id))
      : [];
    const realWaiting = households.some((household) => !household.simulated && needsCall(household));
    if (onLine.length === 0 && simulatedWaiting.length === 0 && !realWaiting) return await finish(ctx, control, households);
    const nearby = households.filter(located);
    const byId = new Map(households.map((household) => [household._id, household]));
    for (const call of onLine) {
      const household = byId.get(call.householdId);
      if (household) await advanceReadyCall(ctx, call, household, nearby, speed);
    }
    await dialReadyCalls(ctx, control, simulatedWaiting, onLine.length, speed);
    await ctx.scheduler.runAfter(READY_TICK_MS, internal.ready.tick, { generation });
    return null;
  },
});
