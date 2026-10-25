/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { completeAssignment } from "../../convex/offers";
import { HouseFacts, stageOf } from "../../lib/claim-stage";
import { registerHouseholdCounts } from "./householdCounts";

const modules = import.meta.glob("../../convex/**/*.ts");
const MINUTE = 60_000;

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  return t;
}

type T = ReturnType<typeof setup>;

const FIRE_AT = 1_000_000_000;

const FACTS: HouseFacts = {
  address: "12 Oak St",
  residentName: "Carmen",
  warningIssued: true,
  inZone: true,
  callStatus: "not_called",
  away: false,
  fireArrivalAt: FIRE_AT,
  fireReaches: true,
  out: null,
  ride: { state: "none" },
};

describe("the judge's phone: which stage a claimed house is in", () => {
  test("a missing claim reads as given back, and nothing counts before the warning", () => {
    expect(stageOf(null, FIRE_AT)).toEqual({ kind: "given_back" });
    const boarded = { ...FACTS, warningIssued: false, out: { how: "ride" as const, at: FIRE_AT - MINUTE, byFirstName: "Luis" } };
    expect(stageOf(boarded, FIRE_AT + MINUTE)).toEqual({ kind: "waiting" });
  });

  test("before the fire, the live stage and the minutes left", () => {
    expect(stageOf(FACTS, FIRE_AT - 42 * MINUTE)).toMatchObject({ kind: "live", step: "calling", minutesToFire: 42 });
    expect(stageOf({ ...FACTS, callStatus: "in_call" }, FIRE_AT - MINUTE)).toMatchObject({ step: "on_call" });
    expect(stageOf({ ...FACTS, callStatus: "door_check" }, FIRE_AT - MINUTE)).toMatchObject({ step: "door_check" });
    expect(stageOf({ ...FACTS, callStatus: "complete", ride: { state: "requested" } }, FIRE_AT - MINUTE)).toMatchObject({ step: "ride_requested" });
    const coming = { state: "coming" as const, by: "driver" as const, byFirstName: "Luis", etaAt: FIRE_AT - 20 * MINUTE };
    expect(stageOf({ ...FACTS, callStatus: "complete", ride: coming }, FIRE_AT - 30 * MINUTE)).toMatchObject({ step: "ride_coming", ride: coming });
    expect(stageOf({ ...FACTS, inZone: false }, FIRE_AT - MINUTE)).toMatchObject({ step: "outside_zone" });
  });

  test("boarded before the fire is safe, with the minutes to spare", () => {
    const out = { how: "ride" as const, at: FIRE_AT - 23 * MINUTE, byFirstName: "Luis" };
    expect(stageOf({ ...FACTS, out }, FIRE_AT + 60 * MINUTE)).toEqual({ kind: "safe", how: "ride", byFirstName: "Luis", minutesToSpare: 23 });
    expect(stageOf({ ...FACTS, out: { how: "self", at: FIRE_AT - 50 * MINUTE, byFirstName: null } }, FIRE_AT - 40 * MINUTE)).toMatchObject({ kind: "safe", how: "self" });
  });

  test("the fire reaching the home first is lost, whether the ride never came or came late", () => {
    expect(stageOf(FACTS, FIRE_AT)).toEqual({ kind: "lost", rideCameLate: false });
    const coming = { state: "coming" as const, by: "driver" as const, byFirstName: "Luis", etaAt: FIRE_AT + 5 * MINUTE };
    expect(stageOf({ ...FACTS, ride: coming }, FIRE_AT + MINUTE)).toEqual({ kind: "lost", rideCameLate: false });
    const late = { how: "ride" as const, at: FIRE_AT + 4 * MINUTE, byFirstName: "Luis" };
    expect(stageOf({ ...FACTS, out: late }, FIRE_AT + 10 * MINUTE)).toEqual({ kind: "lost", rideCameLate: true });
  });

  test("nobody home is safe, and a home the fire never reaches is spared at its deadline", () => {
    expect(stageOf({ ...FACTS, away: true }, FIRE_AT + MINUTE)).toMatchObject({ kind: "safe", how: "away" });
    const unburned = { ...FACTS, fireReaches: false };
    expect(stageOf(unburned, FIRE_AT - MINUTE)).toMatchObject({ kind: "live", minutesToFire: null });
    expect(stageOf(unburned, FIRE_AT)).toEqual({ kind: "spared" });
  });
});

async function demoHouse(t: T) {
  return await t.run(async (ctx) =>
    ctx.db.insert("households", {
      address: "12 Oak St",
      lat: 34.19,
      lng: -118.15,
      callbackNumber: "+16265551001",
      language: "en",
      callStatus: "not_called",
      outcome: "unknown",
      inZone: true,
      attempts: 0,
      needPrior: 0.5,
      needProbability: 0.5,
      fireArrivalAt: Date.now() + 90 * MINUTE,
      callPriority: 1,
      simulated: true,
    }),
  );
}

const RECORD = {
  residentName: "Carmen Ruiz",
  language: "en",
  canLeave: "no" as const,
  peopleCount: 1,
  mobility: "manual_wheelchair" as const,
  assistanceRequired: "one_person_assist" as const,
  medical: [],
  pets: false,
  hasCar: false,
};

async function claimedHouse(t: T) {
  const householdId = await demoHouse(t);
  const code = await t.mutation(api.claims.startKiosk, {});
  await t.mutation(api.claims.submitPhone, { code, phone: "415-555-0196" });
  await t.mutation(api.claims.claim, { code, householdId, record: RECORD });
  const session = await t.query(api.claims.session, { code });
  return { householdId, token: session!.statusToken! };
}

async function issueWarning(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("control", {
      warningIssuedAt: Date.now(),
      dialerRunning: false,
      maxConcurrentCalls: 6,
      simulateVoice: true,
      simulateNeedModel: true,
      simulateDispatch: true,
      simulateDrivers: true,
      autoApprove: false,
      tickGeneration: 0,
    });
  });
}

async function vanPicksUp(t: T, householdId: Id<"households">) {
  await t.run(async (ctx) => {
    const load = { seats: 0, wheelchairSpaces: 1, stretcherSpaces: 0 };
    const requestId = await ctx.db.insert("requests", {
      householdId, status: "driver_accepted", load, crewNeeded: 1, needsLift: true, boardingMinutes: 8, deadlineAt: 0, weight: 1, updatedAt: 0,
    });
    const vehicleId = await ctx.db.insert("vehicles", {
      label: "Van 1", type: "paratransit", driverName: "Luis Ortega", lat: 34.19, lng: -118.155, seats: 6, wheelchairSpaces: 1,
      stretcherSpaces: 0, crewSize: 1, liftCapable: true, shiftEndsAt: 0, driverIsSimulated: true,
    });
    const assignmentId = await ctx.db.insert("assignments", {
      requestId, householdId, vehicleId, planVersion: 1, status: "accepted", etaMinutes: 5, stopOrder: 0, proposedAt: Date.now(),
    });
    await completeAssignment(ctx as never, assignmentId);
  });
}

describe("the judge's phone: the status link", () => {
  test("a claim gets a long status token, and the phone sees only that house's display fields", async () => {
    const t = setup();
    const { token } = await claimedHouse(t);
    expect(token).toMatch(/^[2-9a-z]{24}$/);
    const status = await t.query(api.claimStatus.forToken, { token });
    expect(status?.facts).toMatchObject({ address: "12 Oak St", residentName: "Carmen Ruiz", warningIssued: false, out: null });
    expect(Object.keys(status!.facts).sort()).toEqual(["address", "away", "callStatus", "fireArrivalAt", "fireReaches", "inZone", "out", "residentName", "ride", "warningIssued"]);
    expect(JSON.stringify(status)).not.toContain("+14155550196");
    expect(stageOf(status!.facts, Date.now())).toEqual({ kind: "waiting" });
    expect(await t.query(api.claimStatus.forToken, { token: "x".repeat(24) })).toBeNull();
    expect(await t.query(api.claimStatus.forToken, { token: "short" })).toBeNull();
  });

  test("a driver who accepts shows by first name, and boarding before the fire reads as safe", async () => {
    const t = setup();
    const { householdId, token } = await claimedHouse(t);
    await issueWarning(t);
    await t.run(async (ctx) => {
      const load = { seats: 0, wheelchairSpaces: 1, stretcherSpaces: 0 };
      await ctx.db.insert("requests", { householdId, status: "received", load, crewNeeded: 1, needsLift: true, boardingMinutes: 8, deadlineAt: 0, weight: 1, updatedAt: 0 });
    });
    const requested = await t.query(api.claimStatus.forToken, { token });
    expect(stageOf(requested!.facts, Date.now())).toMatchObject({ kind: "live", step: "ride_requested" });
    await t.run(async (ctx) => {
      for (const request of await ctx.db.query("requests").collect()) await ctx.db.delete("requests", request._id);
    });

    await vanPicksUp(t, householdId);
    const status = await t.query(api.claimStatus.forToken, { token });
    expect(status!.facts.out).toMatchObject({ how: "ride", byFirstName: "Luis" });
    expect(stageOf(status!.facts, Date.now() + 120 * MINUTE)).toMatchObject({ kind: "safe", how: "ride", byFirstName: "Luis" });
  });

  test("a van that boards after the fire reached the home reads as lost", async () => {
    const t = setup();
    const { householdId, token } = await claimedHouse(t);
    await issueWarning(t);
    await t.run(async (ctx) => ctx.db.patch("households", householdId, { fireArrivalAt: Date.now() - MINUTE }));
    await vanPicksUp(t, householdId);
    const status = await t.query(api.claimStatus.forToken, { token });
    expect(stageOf(status!.facts, Date.now())).toEqual({ kind: "lost", rideCameLate: true });
  });

  test("a neighbor pickup left over from the house's demo resident doesn't count for the judge's", async () => {
    const t = setup();
    const householdId = await demoHouse(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("pickupPlans", { householdId, helperName: "Esperanza", helperPhone: "+16265550101", status: "done", helperAttempts: 1, residentAttempts: 1, updatedAt: Date.now(), simulated: true });
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const code = await t.mutation(api.claims.startKiosk, {});
    await t.mutation(api.claims.submitPhone, { code, phone: "415-555-0196" });
    await t.mutation(api.claims.claim, { code, householdId, record: RECORD });
    const token = (await t.query(api.claims.session, { code }))!.statusToken!;
    await issueWarning(t);
    const status = await t.query(api.claimStatus.forToken, { token });
    expect(status!.facts).toMatchObject({ out: null, ride: { state: "none" } });
  });

  test("releaseHouse gives back one judge's house and leaves the others", async () => {
    const t = setup();
    const { householdId, token } = await claimedHouse(t);
    const other = await t.run(async (ctx) => {
      const home = await ctx.db.get("households", householdId);
      const { _id, _creationTime, ...fields } = home!;
      return await ctx.db.insert("households", { ...fields, address: "14 Oak St", callbackNumber: "+16265551002", simulated: true, standIn: undefined });
    });
    const code = await t.mutation(api.claims.startKiosk, {});
    await t.mutation(api.claims.submitPhone, { code, phone: "415-555-0197" });
    await t.mutation(api.claims.claim, { code, householdId: other, record: RECORD });
    const otherToken = (await t.query(api.claims.session, { code }))!.statusToken!;

    expect(await t.mutation(internal.claims.releaseHouse, { householdId })).toEqual({ released: true });
    expect(await t.query(api.claimStatus.forToken, { token })).toBeNull();
    expect(await t.query(api.claimStatus.forToken, { token: otherToken })).not.toBeNull();
    expect(await t.mutation(internal.claims.releaseHouse, { householdId })).toEqual({ released: false });
  });

  test("clearAll gives the house back, and the link stops working", async () => {
    const t = setup();
    const { token } = await claimedHouse(t);
    await t.mutation(api.claims.clearAll, {});
    expect(await t.query(api.claimStatus.forToken, { token })).toBeNull();
  });
});
