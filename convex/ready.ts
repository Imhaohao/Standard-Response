import { ObjectType, v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { assistanceRequired, bedroomFloor, bedroomSide, careNeed, exitPlan, medicalNeed, mobility } from "./schema";
import { callPriorityFor, located } from "./model";
import { fileLanguageOf } from "./languages";
import { seedSimulatedArea } from "./seed";
import { Helper, saveProfile } from "./readyProfile";
import { helperFor, profileFromPersona } from "./readySim";
import { seededRandom } from "./roll";

// The Ready check: before any disaster, every household tells us who lives there, what help they
// need getting out, where they sleep, and who has agreed to pick them up. The agent calls each
// home (Track B's `ready` call mode, or the stand-in below for simulated homes), or the household
// signs up on its phone at /ready.

const READY_TICK_MS = 700;
const HOMES_PER_TICK = 3;
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

function profileFrom(args: ProfileArgs, via: "call" | "form") {
  const { exitPlan: plan, bedroom: room, care, note, helper: arranged, ...record } = args;
  const ready = { at: Date.now(), via, verified: via === "call", exitPlan: plan, bedroom: room, care, note: blankToUndefined(note) };
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
  if (existing) {
    await ctx.db.patch("households", existing._id, { address: place.address, lat: place.lat, lng: place.lng });
    return existing._id;
  }
  const now = Date.now();
  const fireArrivalAt = now + PLACEHOLDER_ARRIVAL_MINUTES * 60_000;
  return await ctx.db.insert("households", {
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    callbackNumber: place.phone,
    language: fileLanguageOf(place.language),
    callStatus: "not_called",
    outcome: "unknown",
    inZone: false,
    attempts: 0,
    needPrior: UNKNOWN_NEED_PRIOR,
    needProbability: UNKNOWN_NEED_PRIOR,
    fireArrivalAt,
    callPriority: callPriorityFor(UNKNOWN_NEED_PRIOR, fireArrivalAt, now),
    simulated: false,
  });
}

// /ready: a household signs itself up. It stays unverified until the agent confirms it by phone.
export const submit = mutation({
  args: { phone: v.string(), address: v.string(), lat: v.number(), lng: v.number(), language: v.string(), ...profileArgs },
  returns: v.id("households"),
  handler: async (ctx, { phone, address, lat, lng, language, ...profile }) => {
    if (phone.trim() === "" || address.trim() === "") throw new Error("A phone number and an address are needed");
    const householdId = await findOrCreateHome(ctx, { phone: phone.trim(), address: address.trim(), lat, lng, language });
    await saveProfile(ctx, householdId, profileFrom(profile, "form"));
    await ctx.db.insert("events", { kind: "record", message: `${address.trim()} signed up for the Ready check`, householdId, at: Date.now() });
    return householdId;
  },
});

// Voice server: a Ready check call finished with a profile.
export const saveFromCall = mutation({
  args: { householdId: v.id("households"), ...profileArgs },
  returns: v.null(),
  handler: async (ctx, { householdId, ...profile }) => {
    await saveProfile(ctx, householdId, profileFrom(profile, "call"));
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
    if (control.warningIssuedAt) throw new Error("The Ready check runs before a warning. Reset first");
    const now = Date.now();
    if (!(await ctx.db.query("households").first())) await seedSimulatedArea(ctx, now);
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
    return null;
  },
});

// People pick up more readily on a calm afternoon than in the middle of an evacuation.
const READY_ANSWER_BOOST = 0.15;

async function standInReadyCall(ctx: MutationCtx, household: Doc<"households">, nearby: (Doc<"households"> & { lat: number; lng: number })[]) {
  const persona = await ctx.db
    .query("personas")
    .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
    .unique();
  if (!persona) return;
  const random = seededRandom(`${household._id}:${household.readyMisses ?? 0}`);
  if (random() > persona.answersPhone + READY_ANSWER_BOOST) {
    await ctx.db.patch("households", household._id, { readyMisses: (household.readyMisses ?? 0) + 1 });
    return;
  }
  const profile = profileFromPersona(persona, random, Date.now());
  const arranged = profile.ready.exitPlan === "helper" && located(household) ? await helperFor(ctx, household, nearby, random) : undefined;
  await saveProfile(ctx, household._id, { ...profile, helper: arranged });
}

async function finish(ctx: MutationCtx, control: Doc<"control">, households: Doc<"households">[]) {
  const profiled = households.filter((household) => household.ready).length;
  await ctx.db.patch("control", control._id, { readyCheckRunning: false });
  await ctx.db.insert("events", { kind: "control", message: `Ready check finished: ${profiled} of ${households.length} homes on file`, at: Date.now() });
}

// One step of the stand-in campaign: a few simulated homes "answer" per tick, so the map fills in.
export const tick = internalMutation({
  args: { generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { generation }) => {
    const control = await ctx.db.query("control").first();
    if (!control?.readyCheckRunning || control.readyCheckGeneration !== generation || control.warningIssuedAt) return null;
    const households = await ctx.db.query("households").take(1000);
    const simulatedWaiting = control.simulateVoice ? households.filter((household) => household.simulated && needsCall(household)) : [];
    const realWaiting = households.some((household) => !household.simulated && needsCall(household));
    if (simulatedWaiting.length === 0 && !realWaiting) return await finish(ctx, control, households);
    const nearby = households.filter(located);
    for (const household of simulatedWaiting.slice(0, HOMES_PER_TICK)) await standInReadyCall(ctx, household, nearby);
    await ctx.scheduler.runAfter(READY_TICK_MS, internal.ready.tick, { generation });
    return null;
  },
});
