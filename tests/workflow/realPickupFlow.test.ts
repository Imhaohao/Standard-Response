/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/realPickupFlow.test.ts --environment edge-runtime
// Real households (simulated: false) through the whole night, the way the voice server drives it:
// the Ready check before the warning, the warning calls, then the pickup calls to both sides.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

// About 50 m apart on one street. The neighbor is on the side the stand-in fire reaches first, so
// driving over to the resident is driving away from it.
const RESIDENT = { phone: "+15550000001", address: "1210 Palm St", lat: 34.19, lng: -118.155, residentName: "Wen" };
const NEIGHBOR = { phone: "+15550000002", address: "1212 Palm St", lat: 34.19, lng: -118.15445, residentName: "Ana" };

async function signUpBoth(t: T) {
  await t.mutation(api.control.reset, {});
  const profile = { language: "en", care: [] };
  // The resident signs up first: sign-up order must not decide who counts as upwind.
  const resident = await t.mutation(api.ready.submit, { ...profile, ...RESIDENT, exitPlan: "needs_ride", hasCar: false });
  const neighbor = await t.mutation(api.ready.submit, { ...profile, ...NEIGHBOR, exitPlan: "own_car", hasCar: true });
  return { resident, neighbor };
}

const plansFor = (t: T, householdId: Id<"households">) =>
  t.run(async (ctx) => ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).collect());

describe("real households on the night", () => {
  test("a warning with no zone drawn calls every home that signed up", async () => {
    const t = setup();
    await signUpBoth(t);
    await t.mutation(api.control.issueWarning, {});
    const queued = await t.query(api.voice.dialQueue, { limit: 10 });
    expect(queued.map((home) => home.address).sort()).toEqual([RESIDENT.address, NEIGHBOR.address]);
  });

  test("a pickup call shows on the call floor, and ending it leaves the home's own call alone", async () => {
    const t = setup();
    const { resident } = await signUpBoth(t);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const [plan] = await plansFor(t, resident);
    await t.mutation(api.pickups.startAttempt, { planId: plan._id, role: "helper" });
    const flow = { kind: "pickup" as const, planId: plan._id, role: "helper" as const, purpose: "ask" as const };
    const callId = await t.mutation(api.calls.startFlow, { householdId: resident, flow });

    const [listed] = await t.query(api.calls.active, {});
    expect(listed).toMatchObject({ _id: callId, flow, address: RESIDENT.address, attempt: 1 });
    expect((await t.query(api.calls.detail, { callId }))?.speakerName).toBe(NEIGHBOR.residentName);

    const before = await t.run(async (ctx) => ctx.db.get("households", resident));
    await t.mutation(api.calls.end, { callId, answered: false });
    const after = await t.run(async (ctx) => ctx.db.get("households", resident));
    expect(await t.query(api.calls.active, {})).toHaveLength(0);
    expect({ callStatus: after?.callStatus, attempts: after?.attempts }).toEqual({ callStatus: before?.callStatus, attempts: before?.attempts });
  });

  test("the Ready call is given the helper on file until the night's check starts", async () => {
    const t = setup();
    const { resident } = await signUpBoth(t);
    const helper = { name: NEIGHBOR.residentName, phone: NEIGHBOR.phone, relation: "neighbor" };
    await t.mutation(api.ready.submit, { ...RESIDENT, language: "en", care: [], exitPlan: "helper", helper });
    expect(await t.query(api.ready.helperOnFile, { householdId: resident })).toEqual(helper);
    await t.mutation(api.control.issueWarning, {});
    expect(await t.query(api.ready.helperOnFile, { householdId: resident })).toBeNull();
    expect((await plansFor(t, resident))[0].status).toBe("checking");
  });

  test("a home that signs up inside a zone already drawn is called, and one outside it isn't", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    const around = (lat: number, lng: number, d = 0.0002) => [
      { lat: lat - d, lng: lng - d },
      { lat: lat - d, lng: lng + d },
      { lat: lat + d, lng: lng + d },
      { lat: lat + d, lng: lng - d },
    ];
    await t.mutation(api.riders.setZone, { polygon: around(RESIDENT.lat, RESIDENT.lng) });
    const profile = { language: "en", care: [] };
    await t.mutation(api.ready.submit, { ...profile, ...RESIDENT, exitPlan: "needs_ride", hasCar: false });
    await t.mutation(api.ready.submit, { ...profile, ...NEIGHBOR, exitPlan: "own_car", hasCar: true });
    await t.mutation(api.control.issueWarning, {});
    const queued = await t.query(api.voice.dialQueue, { limit: 10 });
    expect(queued.map((home) => home.address)).toEqual([RESIDENT.address]);
  });

  test("a resident who can't leave gets the neighbor with a car asked, whoever signed up first", async () => {
    const t = setup();
    const { resident, neighbor } = await signUpBoth(t);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const plans = await plansFor(t, resident);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ helperHouseholdId: neighbor, status: "checking", recruited: true });
    const queue = await t.query(api.pickups.callQueue, {});
    expect(queue.map((plan) => plan._id)).toEqual([plans[0]._id]);
  });

  test("both sides confirm, then the helper hears the resident is ready", async () => {
    const t = setup();
    const { resident } = await signUpBoth(t);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const [plan] = await plansFor(t, resident);

    await t.mutation(api.pickups.startAttempt, { planId: plan._id, role: "helper" });
    await t.mutation(api.pickups.helperAnswered, { planId: plan._id, coming: true, etaMinutes: 10 });
    const [coming] = await t.query(api.pickups.callQueue, {});
    expect(coming).toMatchObject({ status: "coming", confirmAttempts: 0 });
    expect(coming.residentConfirmedAt).toBeUndefined();

    await t.mutation(api.pickups.startAttempt, { planId: plan._id, role: "resident", purpose: "confirm" });
    await t.mutation(api.pickups.residentConfirmation, { planId: plan._id, confirmed: true });
    const [confirmed] = await t.query(api.pickups.callQueue, {});
    expect(confirmed).toMatchObject({ status: "coming", confirmAttempts: 1, helperNotice: "resident_ready" });
    expect(confirmed.residentConfirmedAt).toBeDefined();
    expect(confirmed.ringing).toBeUndefined();

    await t.mutation(api.pickups.startAttempt, { planId: plan._id, role: "helper", purpose: "notice" });
    await t.mutation(api.pickups.noticeGiven, { planId: plan._id, role: "helper" });
    const [told] = await t.query(api.pickups.callQueue, {});
    expect(told.helperNotice).toBeUndefined();

    await t.mutation(api.pickups.residentAnswered, { planId: plan._id, pickedUp: true });
    expect((await plansFor(t, resident))[0].status).toBe("done");
    expect(await t.query(api.pickups.callQueue, {})).toHaveLength(0);
  });

  test("a resident who says no to the ride ends it, the helper is told, and no other neighbor is asked", async () => {
    const t = setup();
    const { resident } = await signUpBoth(t);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const [plan] = await plansFor(t, resident);
    await t.mutation(api.pickups.helperAnswered, { planId: plan._id, coming: true, etaMinutes: 10 });
    await t.mutation(api.pickups.residentConfirmation, { planId: plan._id, confirmed: false });

    const [ended] = await t.query(api.pickups.callQueue, {});
    expect(ended).toMatchObject({ status: "fell_through", reason: "resident_declined", helperNotice: "called_off" });
    await t.mutation(api.households.update, { householdId: resident, patch: { peopleCount: 1 } });
    expect(await plansFor(t, resident)).toHaveLength(1);
  });

  test("a resident whose later call says they can drive out calls the neighbor off", async () => {
    const t = setup();
    const { resident } = await signUpBoth(t);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const [plan] = await plansFor(t, resident);
    await t.mutation(api.pickups.helperAnswered, { planId: plan._id, coming: true, etaMinutes: 10 });
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "yes", hasCar: true } });
    const [ended] = await t.query(api.pickups.callQueue, {});
    expect(ended).toMatchObject({ status: "fell_through", reason: "not_needed", helperNotice: "called_off" });
  });

  test("a resident who now needs a power wheelchair is taken off the neighbor's car", async () => {
    const t = setup();
    const { resident } = await signUpBoth(t);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const [plan] = await plansFor(t, resident);
    await t.mutation(api.households.update, { householdId: resident, patch: { mobility: "power_wheelchair" } });
    const [ended] = await plansFor(t, resident);
    expect(ended).toMatchObject({ _id: plan._id, status: "fell_through", reason: "needs_changed" });
    // The helper hadn't said yes yet, so there is nobody to call off.
    expect(ended.helperNotice).toBeUndefined();
  });

  test("a helper whose own call says they can't drive after all is dropped, and the resident is told", async () => {
    const t = setup();
    const { resident, neighbor } = await signUpBoth(t);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const [plan] = await plansFor(t, resident);
    await t.mutation(api.pickups.helperAnswered, { planId: plan._id, coming: true, etaMinutes: 10 });
    await t.mutation(api.pickups.residentConfirmation, { planId: plan._id, confirmed: true });
    await t.mutation(api.households.update, { householdId: neighbor, patch: { canLeave: "no" } });
    const ended = (await plansFor(t, resident)).find((row) => row._id === plan._id);
    expect(ended).toMatchObject({ status: "fell_through", reason: "helper_declined", residentNotice: "helper_cancelled" });
  });

  test("a missed confirmation is retried once, then the pickup goes on without it", async () => {
    const t = setup();
    const { resident } = await signUpBoth(t);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const [plan] = await plansFor(t, resident);
    await t.mutation(api.pickups.helperAnswered, { planId: plan._id, coming: true, etaMinutes: 10 });
    for (let i = 0; i < 2; i += 1) {
      await t.mutation(api.pickups.startAttempt, { planId: plan._id, role: "resident", purpose: "confirm" });
      await t.mutation(api.pickups.unanswered, { planId: plan._id, role: "resident", purpose: "confirm" });
    }
    const [row] = await t.query(api.pickups.callQueue, {});
    expect(row).toMatchObject({ status: "coming", confirmAttempts: 2, residentAttempts: 0 });
  });
});
