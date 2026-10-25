/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";
import { startPickupChecks } from "../../convex/pickups";

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

async function draft(t: T, index: number) {
  const householdId = await t.run(async (ctx) => ctx.db.insert("households", {
    address: `${index + 1} Demo St`, lat: 34.19, lng: -118.15 + index * 0.02,
    callbackNumber: `+16265551${String(index).padStart(3, "0")}`, language: "en",
    callStatus: "not_called", outcome: "unknown", inZone: true, attempts: 0,
    needPrior: 0.5, needProbability: 0.5, fireArrivalAt: Date.now() - 60_000,
    callPriority: 1, simulated: true,
  }));
  const code = await t.mutation(api.claims.startKiosk, {});
  await t.mutation(api.claims.submitPhone, { code, phone: `+14152230${String(index).padStart(3, "0")}` });
  const record = (await t.query(api.claims.draft, { householdId }))!.record;
  return { code, householdId, record: { ...record, residentName: `Person ${index + 1}` } };
}

async function register(t: T, index: number) {
  const args = await draft(t, index);
  await t.mutation(api.claims.claim, args);
  return args.householdId;
}

const homeAt = (t: T, householdId: Id<"households">) => t.run(async (ctx) => ctx.db.get("households", householdId));
const plans = (t: T) => t.run(async (ctx) => ctx.db.query("pickupPlans").collect());

describe("small demo coverage", () => {
  test("registrations alternate van helpers and bedridden residents; every immobile participant is paired through nine sign-ups", async () => {
    const t = setup();
    const ids: Id<"households">[] = [];
    for (let index = 0; index < 9; index++) {
      const id = await register(t, index);
      ids.push(id);
      const driver = index % 2 === 0;
      expect(await homeAt(t, id)).toMatchObject({
        mobility: driver ? "walks" : "bedbound", canLeave: driver ? "yes" : "no", hasCar: driver,
        ready: { exitPlan: driver ? "own_car" : "needs_ride", verified: false },
      });
      const pairings = await plans(t);
      for (const resident of ids.filter((_, position) => position % 2 === 1)) {
        expect(pairings.filter((plan) => plan.householdId === resident)).toHaveLength(1);
      }
      expect(new Set(pairings.map((plan) => plan.helperHouseholdId)).size).toBe(pairings.length);
    }
    expect((await plans(t)).every((plan) => plan.status === "arranged" && plan.recruited)).toBe(true);
    expect((await homeAt(t, ids[0]))?.ready?.note).toContain("van");
    expect(await t.run(async (ctx) => ctx.db.query("calls").collect())).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("requests").collect())).toHaveLength(0);
  });

  test("a distant helper is asked despite fire timing, and wheelchair corrections keep help and the ride request", async () => {
    const t = setup();
    const helper = await register(t, 0);
    const resident = await register(t, 1);
    await t.mutation(api.control.issueWarning, {});
    const [plan] = await plans(t);
    expect(plan).toMatchObject({ householdId: resident, helperHouseholdId: helper, status: "checking" });
    await t.run(async (ctx) => {
      await ctx.db.patch("households", helper, { fireArrivalAt: Date.now() + 60_000 });
      await ctx.db.patch("households", resident, { fireArrivalAt: Date.now() - 60_000 });
      await ctx.db.patch("pickupPlans", plan._id, { status: "arranged", checkStartedAt: undefined });
      await startPickupChecks(ctx, Date.now());
    });
    await t.mutation(api.households.update, { householdId: resident, patch: { mobility: "power_wheelchair", assistanceRequired: "two_person_lift" } });
    expect((await plans(t))[0]).toMatchObject({ _id: plan._id, status: "checking" });
    expect(await t.query(api.requests.forHousehold, { householdId: resident })).toMatchObject({ status: "received" });

    await t.mutation(api.pickups.helperAnswered, { planId: plan._id, coming: true, etaMinutes: 5 });
    expect((await plans(t))[0]).toMatchObject({ status: "coming" });
    expect(await t.query(api.requests.forHousehold, { householdId: resident })).toMatchObject({ status: "received" });
    expect((await homeAt(t, resident))?.outcome).toBe("needs_accessible");
  });

  test("a registration after the warning gets a helper immediately", async () => {
    const t = setup();
    await register(t, 0);
    await t.mutation(api.control.issueWarning, {});
    const resident = await register(t, 1);
    expect((await plans(t))[0]).toMatchObject({ householdId: resident, status: "checking" });
  });

  test("saving a Ready profile keeps a helper paired with the bedridden demo resident", async () => {
    const t = setup();
    const helper = await register(t, 0);
    const resident = await register(t, 1);
    const home = (await homeAt(t, resident))!;
    await t.mutation(api.ready.submit, {
      phone: home.callbackNumber, address: home.address, lat: home.lat!, lng: home.lng!, language: "en",
      exitPlan: "needs_ride", care: [], mobility: "bedbound", hasCar: false,
    });
    expect(await plans(t)).toMatchObject([{ householdId: resident, helperHouseholdId: helper, status: "arranged" }]);
  });

  test("the tenth participant does not activate the small-demo fallback", async () => {
    const t = setup();
    for (let index = 0; index < 9; index++) await register(t, index);
    const tenth = await register(t, 9);
    expect((await plans(t)).filter((plan) => plan.householdId === tenth)).toHaveLength(0);
  });

  test("a stale preview asks for review before saving, and older clients still get the next server role", async () => {
    const t = setup();
    const first = await draft(t, 0);
    const second = await draft(t, 1);
    await t.mutation(api.claims.claim, { ...first, position: 0 });
    await expect(t.mutation(api.claims.claim, { ...second, position: 0 })).rejects.toThrow(/Review the updated demo role/);
    expect((await homeAt(t, second.householdId))?.simulated).toBe(true);
    const updated = await t.query(api.claims.draft, { householdId: second.householdId });
    expect(updated).toMatchObject({ position: 1, record: { mobility: "bedbound" } });
    // An older client that sends its preview still gets the next role in the transaction.
    await t.mutation(api.claims.claim, second);
    expect(await homeAt(t, second.householdId)).toMatchObject({ mobility: "bedbound", hasCar: false });
  });

  test("two simultaneous registrations receive different roles and one pairing", async () => {
    const t = setup();
    const first = await draft(t, 0);
    const second = await draft(t, 1);
    await Promise.all([t.mutation(api.claims.claim, first), t.mutation(api.claims.claim, second)]);
    const homes = await Promise.all([homeAt(t, first.householdId), homeAt(t, second.householdId)]);
    expect(homes.map((home) => home?.hasCar).sort()).toEqual([false, true]);
    expect(await plans(t)).toHaveLength(1);
  });

  test("a declined helper is respected, and a new helper covers the resident without double booking", async () => {
    const t = setup();
    const first = await register(t, 0);
    const resident = await register(t, 1);
    await t.mutation(api.control.issueWarning, {});
    const [plan] = await plans(t);
    await t.mutation(api.pickups.helperAnswered, { planId: plan._id, coming: false });
    const next = await register(t, 2);
    expect((await homeAt(t, first))?.helperDeclinedAt).toBeDefined();
    expect((await plans(t)).filter((p) => p.status === "checking")).toMatchObject([{ householdId: resident, helperHouseholdId: next }]);
  });

  test("clearing claims removes pairings and restores the previous Ready profile and role order", async () => {
    const t = setup();
    const first = await draft(t, 0);
    const ready = { at: 1, via: "call" as const, verified: true, exitPlan: "own_car" as const, care: [], note: "Original profile" };
    await t.run(async (ctx) => ctx.db.patch("households", first.householdId, { ready, helperDeclinedAt: 123 }));
    await t.mutation(api.claims.claim, first);
    expect((await homeAt(t, first.householdId))?.helperDeclinedAt).toBeUndefined();
    const resident = await register(t, 1);
    await t.mutation(api.claims.clearAll, {});
    expect(await plans(t)).toHaveLength(0);
    expect((await homeAt(t, first.householdId))?.ready).toEqual(ready);
    expect((await homeAt(t, first.householdId))?.helperDeclinedAt).toBe(123);
    expect((await homeAt(t, resident))?.ready).toBeUndefined();
    expect(await t.query(api.claims.draft, { householdId: resident })).toMatchObject({ position: 0, record: { hasCar: true } });
  });

  test("releasing a helper cancels its pending plan and pairs an available demo helper", async () => {
    const t = setup();
    const helper = await register(t, 0);
    const resident = await register(t, 1);
    const spare = await register(t, 2);
    await t.mutation(internal.claims.releaseHouse, { householdId: helper });
    expect(await plans(t)).toMatchObject([{ householdId: resident, helperHouseholdId: spare, status: "arranged" }]);
  });

  test("an away resident or a resident who declined is not paired again", async () => {
    const t = setup();
    await register(t, 0);
    const resident = await register(t, 1);
    await t.mutation(api.control.issueWarning, {});
    const [plan] = await plans(t);
    await t.mutation(api.pickups.helperAnswered, { planId: plan._id, coming: true });
    await t.mutation(api.pickups.residentConfirmation, { planId: plan._id, confirmed: false });
    await t.mutation(api.households.update, { householdId: resident, patch: { mobility: "power_wheelchair" } });
    expect((await plans(t)).filter((p) => p.status !== "fell_through")).toHaveLength(0);
    await t.mutation(api.households.update, { householdId: resident, patch: { away: true } });
    await register(t, 2);
    expect((await plans(t)).filter((p) => p.status !== "fell_through")).toHaveLength(0);
  });
});
