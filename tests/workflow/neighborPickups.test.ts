/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// Run with: npx vitest run tests/workflow/neighborPickups.test.ts --environment edge-runtime

const modules = import.meta.glob("../../convex/**/*.ts");
const MINUTE = 60_000;
// One clock for every home, so equal arrival times really are equal.
const WARNING_AT = Date.now();
// About 50 m apart on the same street.
const RESIDENT = { lat: 34.1900, lng: -118.1550 };
const NEIGHBOR = { lat: 34.1900, lng: -118.15445 };

function setup() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "householdsByOutcome");
  aggregateTest.register(t, "householdsByCallStatus");
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

async function insertHousehold(t: T, address: string, phone: string, at: { lat: number; lng: number }, fireMinutes = 90) {
  return await t.run(async (ctx) =>
    ctx.db.insert("households", {
      address,
      callbackNumber: phone,
      language: "en",
      callStatus: "not_called",
      outcome: "unknown",
      inZone: true,
      attempts: 0,
      needPrior: 0.5,
      needProbability: 0.5,
      fireArrivalAt: WARNING_AT + fireMinutes * MINUTE,
      callPriority: 1,
      simulated: false,
      ...at,
    }),
  );
}

const plansFor = (t: T, householdId: Id<"households">) =>
  t.run(async (ctx) => ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).collect());

describe("neighbor pickup ask", () => {
  test("a neighbor whose call says they have a car after the resident's says they can't leave is asked", async () => {
    const t = setup();
    const resident = await insertHousehold(t, "1210 Palm St", "+15550000001", RESIDENT);
    const neighbor = await insertHousehold(t, "1212 Palm St", "+15550000002", NEIGHBOR);

    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    expect(await plansFor(t, resident)).toHaveLength(0);

    await t.mutation(api.households.update, { householdId: neighbor, patch: { canLeave: "yes", hasCar: true } });
    const plans = await plansFor(t, resident);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ helperHouseholdId: neighbor, status: "checking", recruited: true });

    // Saying the same thing again doesn't ask them twice.
    await t.mutation(api.households.update, { householdId: neighbor, patch: { hasCar: true } });
    expect(await plansFor(t, resident)).toHaveLength(1);
  });

  test("a neighbor the fire reaches after the resident is still not asked", async () => {
    const t = setup();
    const resident = await insertHousehold(t, "1210 Palm St", "+15550000001", RESIDENT, 60);
    const neighbor = await insertHousehold(t, "1212 Palm St", "+15550000002", NEIGHBOR, 90);

    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    await t.mutation(api.households.update, { householdId: neighbor, patch: { canLeave: "yes", hasCar: true } });
    expect(await plansFor(t, resident)).toHaveLength(0);
  });
});
