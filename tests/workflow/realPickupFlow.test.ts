/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// Run with: npx vitest run tests/workflow/realPickupFlow.test.ts --environment edge-runtime
// Real households (simulated: false) through the whole night, the way the voice server drives it:
// the Ready check before the warning, the warning calls, then the pickup calls to both sides.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "householdsByOutcome");
  aggregateTest.register(t, "householdsByCallStatus");
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
});
