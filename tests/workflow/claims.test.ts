/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  return t;
}

type T = ReturnType<typeof setup>;

async function demoHouse(t: T, address: string, callbackNumber: string, simulated = true) {
  return await t.run(async (ctx) =>
    ctx.db.insert("households", {
      address,
      lat: 34.19,
      lng: -118.15,
      callbackNumber,
      language: "es",
      callStatus: "not_called",
      outcome: "unknown",
      inZone: true,
      attempts: 0,
      needPrior: 0.5,
      needProbability: 0.5,
      fireArrivalAt: Date.now(),
      callPriority: 1,
      simulated,
    }),
  );
}

const RECORD = {
  residentName: "Carmen",
  language: "es",
  canLeave: "no" as const,
  peopleCount: 2,
  mobility: "manual_wheelchair" as const,
  assistanceRequired: "two_person_lift" as const,
  medical: ["oxygen" as const],
  pets: false,
  hasCar: false,
};

async function signedIn(t: T, phone: string) {
  const code = await t.mutation(api.claims.startKiosk, {});
  await t.mutation(api.claims.submitPhone, { code, phone });
  return code;
}

describe("judge kiosk claims", () => {
  test("a judge's number goes on an open demo house, which becomes a real rider the voice agent will dial", async () => {
    const t = setup();
    const householdId = await demoHouse(t, "12 Oak St", "+16265551001");
    const code = await t.mutation(api.claims.startKiosk, {});
    expect(await t.mutation(api.claims.submitPhone, { code, phone: "(415) 223-0142" })).toEqual({ phoneEnding: "0142" });
    expect(await t.query(api.claims.session, { code })).toMatchObject({ expired: false, phoneEnding: "0142", claimedAddress: null });

    expect(await t.mutation(api.claims.claim, { code, householdId, record: RECORD })).toEqual({ address: "12 Oak St" });
    const home = await t.run(async (ctx) => ctx.db.get("households", householdId));
    expect(home).toMatchObject({ callbackNumber: "+14152230142", simulated: false, residentName: "Carmen", mobility: "manual_wheelchair", outcome: "needs_accessible", callStatus: "not_called" });
    expect(await t.query(api.claims.session, { code })).toMatchObject({ claimedAddress: "12 Oak St" });
    expect((await t.query(api.claims.homes, {}))[0]).toMatchObject({ _id: householdId, state: "taken", address: null });
    const dialQueue = await t.query(api.voice.dialQueue, { limit: 5 });
    expect(dialQueue.map((row) => row._id)).toContain(householdId);
    const calls = await t.run(async (ctx) => ctx.db.query("calls").collect());
    expect(calls).toHaveLength(0);
  });

  test("two judges can't take the same house, and one phone takes one house", async () => {
    const t = setup();
    const householdId = await demoHouse(t, "12 Oak St", "+16265551001");
    const other = await demoHouse(t, "14 Oak St", "+16265551002");
    const first = await signedIn(t, "4152230142");
    const second = await signedIn(t, "4152230143");
    await t.mutation(api.claims.claim, { code: first, householdId, record: RECORD });
    await expect(t.mutation(api.claims.claim, { code: second, householdId, record: RECORD })).rejects.toThrow(/isn't open/);
    await expect(t.mutation(api.claims.claim, { code: first, householdId: other, record: RECORD })).rejects.toThrow(/already took a house/);
    const third = await t.mutation(api.claims.startKiosk, {});
    await expect(t.mutation(api.claims.submitPhone, { code: third, phone: "415-223-0142" })).rejects.toThrow(/already has a house/);
  });

  test("a rider-list house with a 555 number is open, and a house with someone's real number never shows", async () => {
    const t = setup();
    const riderListHouse = await demoHouse(t, "20 Elm St", "+16265550120", false);
    await demoHouse(t, "22 Elm St", "+14155550001", false);
    await demoHouse(t, "24 Elm St", "+13105217788", false);
    const shown = await t.query(api.claims.homes, {});
    expect(shown.map((home) => home.address)).toEqual(["20 Elm St", "22 Elm St"]);
    const code = await signedIn(t, "4152230142");
    await t.mutation(api.claims.claim, { code, householdId: riderListHouse, record: RECORD });
    await t.mutation(api.claims.clearAll, {});
    const home = await t.run(async (ctx) => ctx.db.get("households", riderListHouse));
    expect(home).toMatchObject({ callbackNumber: "+16265550120", simulated: false });
  });

  test("bad input is refused before anything is written", async () => {
    const t = setup();
    const householdId = await demoHouse(t, "12 Oak St", "+16265551001");
    const code = await t.mutation(api.claims.startKiosk, {});
    await expect(t.mutation(api.claims.submitPhone, { code, phone: "12" })).rejects.toThrow(/phone number/);
    await expect(t.mutation(api.claims.submitPhone, { code: "nope", phone: "4152230142" })).rejects.toThrow(/expired/);
    await expect(t.mutation(api.claims.claim, { code, householdId, record: RECORD })).rejects.toThrow(/phone number first/);
    await t.mutation(api.claims.submitPhone, { code, phone: "4152230142" });
    await expect(t.mutation(api.claims.claim, { code, householdId, record: { ...RECORD, peopleCount: 40 } })).rejects.toThrow(/1 to 12/);
    await expect(t.mutation(api.claims.claim, { code, householdId, record: { ...RECORD, residentName: "  " } })).rejects.toThrow(/name/);
    const home = await t.run(async (ctx) => ctx.db.get("households", householdId));
    expect(home).toMatchObject({ simulated: true, callbackNumber: "+16265551001" });
  });

  test("clearAll takes every judge's number off and puts the demo house back", async () => {
    const t = setup();
    const householdId = await demoHouse(t, "12 Oak St", "+16265551001");
    const code = await signedIn(t, "4152230142");
    await t.mutation(api.claims.claim, { code, householdId, record: RECORD });

    expect(await t.mutation(api.claims.clearAll, {})).toEqual({ cleared: 1, skippedOnCall: 0 });
    const home = await t.run(async (ctx) => ctx.db.get("households", householdId));
    expect(home).toMatchObject({ callbackNumber: "+16265551001", simulated: true, language: "es", outcome: "unknown" });
    expect(home?.mobility).toBeUndefined();
    const left = await t.run(async (ctx) => ({ claims: await ctx.db.query("claims").collect(), sessions: await ctx.db.query("kioskSessions").collect() }));
    expect(left).toEqual({ claims: [], sessions: [] });
    expect((await t.query(api.claims.homes, {}))[0]).toMatchObject({ state: "open", address: "12 Oak St" });
  });
});
