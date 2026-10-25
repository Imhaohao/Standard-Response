/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/readyPairing.test.ts --environment edge-runtime
// The Ready check pairs a home that needs a ride with the nearest neighbor who has a car; on the
// night that neighbor is asked once the resident's call says they can't get out.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

// The stand-in fire comes from the northeast, so a neighbor east of the resident is reached first and
// driving over is driving away from it; one to the west would be driving toward it.
const RESIDENT = { phone: "+15550000001", address: "1210 Palm St", lat: 34.19, lng: -118.155, residentName: "Wen" };
const EAST = { phone: "+15550000002", address: "1212 Palm St", lat: 34.19, lng: -118.15445, residentName: "Ana" };
const WEST = { phone: "+15550000003", address: "1200 Palm St", lat: 34.19, lng: -118.1554, residentName: "Rosa" };
const FAR = { phone: "+15550000004", address: "40 Far Rd", lat: 34.2, lng: -118.155, residentName: "Lee" };

const base = { language: "en", care: [] };
const needsRide = (who: typeof RESIDENT, extra: object = {}) => ({ ...base, ...who, exitPlan: "needs_ride" as const, hasCar: false, mobility: "walker" as const, ...extra });
const drives = (who: typeof RESIDENT) => ({ ...base, ...who, exitPlan: "own_car" as const, hasCar: true });

async function fresh(t: T) {
  await t.mutation(api.control.reset, {});
}

const plansFor = (t: T, householdId: Id<"households">) =>
  t.run(async (ctx) => ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).collect());

describe("pairing at the Ready check", () => {
  test("pairs a home that needs a ride with the nearest neighbor who has a car, and asks them once the resident can't get out", async () => {
    const t = setup();
    await fresh(t);
    const resident = await t.mutation(api.ready.submit, needsRide(RESIDENT));
    const neighbor = await t.mutation(api.ready.submit, drives(EAST));
    const [pairing] = await plansFor(t, resident);
    expect(pairing).toMatchObject({ helperHouseholdId: neighbor, helperName: "Ana", helperPhone: EAST.phone, status: "arranged", recruited: true });

    // The warning starts the ask on the strength of the Ready check, held for the neighbor's own
    // warning call so one call carries both.
    await t.mutation(api.control.issueWarning, {});
    expect((await plansFor(t, resident))[0].status).toBe("checking");
    const [queued] = await t.query(api.pickups.callQueue, {});
    expect(queued).toMatchObject({ _id: pairing._id, helperAwaitingCall: true, residentAwaitingCall: true });
    const dialed = async () => (await t.query(api.voice.dialQueue, { limit: 10 })).map((home) => home._id);
    expect(await dialed()).toContain(neighbor);
    // While a pickup call rings the neighbor, their own warning call waits.
    await t.mutation(api.pickups.startAttempt, { planId: pairing._id, role: "helper" });
    expect(await dialed()).not.toContain(neighbor);
    await t.mutation(api.pickups.unanswered, { planId: pairing._id, role: "helper" });

    // While the neighbor's warning call rings or is live, it carries the question: no second call.
    const callId = await t.mutation(api.calls.start, { householdId: neighbor, direction: "outbound" });
    expect((await t.query(api.pickups.callQueue, {}))[0].helperAwaitingCall).toBe(true);
    // Once it has ended, a separate pickup call may go out.
    await t.mutation(api.calls.end, { callId, answered: true });
    expect((await t.query(api.pickups.callQueue, {}))[0].helperAwaitingCall).toBe(false);

    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const plans = await plansFor(t, resident);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ _id: pairing._id, status: "checking" });

    // Then the usual pickup check: the helper says yes, the resident confirms, the helper hears back.
    await t.mutation(api.pickups.helperAnswered, { planId: pairing._id, coming: true, etaMinutes: 10 });
    await t.mutation(api.pickups.residentConfirmation, { planId: pairing._id, confirmed: true });
    expect((await t.query(api.pickups.callQueue, {}))[0]).toMatchObject({ status: "coming", helperNotice: "resident_ready" });
  });

  test("the resident confirms on their own call if they're still on it, and on a call of its own if not", async () => {
    const t = setup();
    await fresh(t);
    const resident = await t.mutation(api.ready.submit, needsRide(RESIDENT));
    await t.mutation(api.ready.submit, drives(EAST));
    await t.mutation(api.control.issueWarning, {});
    const [pairing] = await plansFor(t, resident);
    const row = async () => (await t.query(api.pickups.callQueue, {}))[0];

    // The resident's warning call is live when the helper says yes: the confirmation waits for that
    // call, which asks it on the same line, instead of ringing them a second time.
    const callId = await t.mutation(api.calls.start, { householdId: resident, direction: "outbound" });
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    await t.mutation(api.pickups.startAttempt, { planId: pairing._id, role: "helper" });
    await t.mutation(api.pickups.helperAnswered, { planId: pairing._id, coming: true, etaMinutes: 10 });
    expect(await row()).toMatchObject({ status: "coming", residentAwaitingCall: true, confirmAttempts: 0 });

    // They hang up first: the confirmation is no longer held, so its own call goes out, asking only
    // about the ride, and the ride counts once they say yes.
    await t.mutation(api.calls.end, { callId, answered: true });
    expect(await row()).toMatchObject({ status: "coming", residentAwaitingCall: false, confirmAttempts: 0 });
    await t.mutation(api.pickups.startAttempt, { planId: pairing._id, role: "resident", purpose: "confirm" });
    await t.mutation(api.pickups.residentConfirmation, { planId: pairing._id, confirmed: true });
    const confirmed = await row();
    expect(confirmed.residentConfirmedAt).toBeDefined();
    expect(confirmed.helperNotice).toBe("resident_ready");
  });

  test("pairs whichever side signs up first", async () => {
    const t = setup();
    await fresh(t);
    const neighbor = await t.mutation(api.ready.submit, drives(EAST));
    const resident = await t.mutation(api.ready.submit, needsRide(RESIDENT));
    expect((await plansFor(t, resident))[0]).toMatchObject({ helperHouseholdId: neighbor, status: "arranged" });
  });

  test("doesn't pair a home a car can't carry, or a neighbor too far away", async () => {
    const t = setup();
    await fresh(t);
    const chair = await t.mutation(api.ready.submit, needsRide(RESIDENT, { mobility: "power_wheelchair" }));
    await t.mutation(api.ready.submit, drives(EAST));
    expect(await plansFor(t, chair)).toHaveLength(0);

    const t2 = setup();
    await fresh(t2);
    const resident = await t2.mutation(api.ready.submit, needsRide(RESIDENT));
    await t2.mutation(api.ready.submit, drives(FAR));
    expect(await plansFor(t2, resident)).toHaveLength(0);
  });

  test("a neighbor who no longer drives is let go, and the next one is paired", async () => {
    const t = setup();
    await fresh(t);
    const resident = await t.mutation(api.ready.submit, needsRide(RESIDENT));
    const east = await t.mutation(api.ready.submit, drives(EAST));
    const west = await t.mutation(api.ready.submit, drives(WEST));
    expect((await plansFor(t, resident))[0].helperHouseholdId).toBe(east);
    await t.mutation(api.ready.submit, needsRide(EAST));
    const plans = await plansFor(t, resident);
    expect(plans).toHaveLength(1);
    expect(plans[0].helperHouseholdId).toBe(west);
  });

  test("on the night, a paired neighbor who would drive toward the fire is let go and another is asked", async () => {
    const t = setup();
    await fresh(t);
    const resident = await t.mutation(api.ready.submit, needsRide(RESIDENT));
    const west = await t.mutation(api.ready.submit, drives(WEST));
    expect((await plansFor(t, resident))[0].helperHouseholdId).toBe(west);
    const east = await t.mutation(api.ready.submit, drives(EAST));
    await t.mutation(api.control.issueWarning, {});
    expect(await plansFor(t, resident)).toHaveLength(0);
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const plans = await plansFor(t, resident);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ helperHouseholdId: east, status: "checking", recruited: true });
  });
});
