/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// Run with: npx vitest run tests/workflow/neighborCalls.test.ts --environment edge-runtime

const modules = import.meta.glob("../../convex/**/*.ts");
const MINUTE = 60_000;
const WARNING_AT = Date.now();
// About 50 m apart on the same street, and one home about 2 km away.
const HOME = { lat: 34.19, lng: -118.155 };
const NEXT_DOOR = { lat: 34.19, lng: -118.15445 };
const TWO_DOORS = { lat: 34.19, lng: -118.1539 };
const ACROSS_TOWN = { lat: 34.208, lng: -118.155 };

function setup() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "householdsByOutcome");
  aggregateTest.register(t, "householdsByCallStatus");
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

async function insertHousehold(t: T, address: string, phone: string, at: { lat: number; lng: number }, needProbability = 0.2) {
  return await t.run(async (ctx) =>
    ctx.db.insert("households", {
      address,
      callbackNumber: phone,
      language: "en",
      callStatus: "not_called",
      outcome: "unknown",
      inZone: true,
      attempts: 0,
      needPrior: needProbability,
      needProbability,
      fireArrivalAt: WARNING_AT + 90 * MINUTE,
      callPriority: needProbability,
      simulated: false,
      ...at,
    }),
  );
}

const queue = (t: T) => t.query(api.households.queue, { limit: 10 });

const plansFor = (t: T, householdId: Id<"households">) =>
  t.run(async (ctx) => ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).collect());

describe("neighbor calls", () => {
  test("a home that can't get out moves the neighbors who may have a car to the front of the queue", async () => {
    const t = setup();
    const resident = await insertHousehold(t, "1210 Palm St", "+15550000001", HOME);
    const neighbor = await insertHousehold(t, "1212 Palm St", "+15550000002", NEXT_DOOR);
    const noCar = await insertHousehold(t, "1214 Palm St", "+15550000003", TWO_DOORS);
    const far = await insertHousehold(t, "300 Pine St", "+15550000004", ACROSS_TOWN);
    // Already known to have no car, and the highest priority before anything is heard.
    await t.run(async (ctx) => ctx.db.patch("households", noCar, { hasCar: false, callPriority: 5 }));

    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    const [first, ...rest] = await queue(t);
    expect(first._id).toBe(neighbor);
    expect(first.planReason).toContain("1210 Palm St");
    expect(rest.find((h) => h._id === noCar)?.planReason).toBeUndefined();
    expect(rest.find((h) => h._id === far)?.planReason).toBeUndefined();

    // Their call says they have a car, and the neighbor ask calls them to pick the resident up.
    await t.mutation(api.calls.start, { householdId: neighbor, direction: "outbound" });
    expect((await queue(t)).some((h) => h.planReason !== undefined)).toBe(false);
    await t.mutation(api.households.update, { householdId: neighbor, patch: { canLeave: "yes", hasCar: true } });
    expect(await plansFor(t, resident)).toMatchObject([{ helperHouseholdId: neighbor, status: "checking", recruited: true }]);
  });

  test("a neighbor driving out moves the homes nearby likeliest to need a ride to the front of the queue", async () => {
    const t = setup();
    const driver = await insertHousehold(t, "1210 Palm St", "+15550000001", HOME);
    const likely = await insertHousehold(t, "1212 Palm St", "+15550000002", NEXT_DOOR, 0.6);
    const unlikely = await insertHousehold(t, "1214 Palm St", "+15550000003", TWO_DOORS, 0.1);
    await t.run(async (ctx) => ctx.db.patch("households", unlikely, { callPriority: 5 }));

    await t.mutation(api.households.update, { householdId: driver, patch: { canLeave: "yes", hasCar: true } });
    const [first, ...rest] = await queue(t);
    expect(first._id).toBe(likely);
    expect(first.planReason).toContain("1210 Palm St");
    expect(rest.find((h) => h._id === unlikely)?.planReason).toBeUndefined();

    // Their call says they can't get out, and the driver is asked to pick them up.
    await t.mutation(api.calls.start, { householdId: likely, direction: "outbound" });
    await t.mutation(api.households.update, { householdId: likely, patch: { canLeave: "no" } });
    expect(await plansFor(t, likely)).toMatchObject([{ helperHouseholdId: driver, status: "checking", recruited: true }]);
  });

  test("a home that gets a helper on the way no longer holds its neighbors at the front", async () => {
    const t = setup();
    const resident = await insertHousehold(t, "1210 Palm St", "+15550000001", HOME);
    const neighbor = await insertHousehold(t, "1212 Palm St", "+15550000002", NEXT_DOOR);

    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    expect((await queue(t))[0]._id).toBe(neighbor);
    await t.run(async (ctx) =>
      ctx.db.insert("pickupPlans", {
        householdId: resident,
        helperName: "Ana",
        helperPhone: "+15550000009",
        status: "coming",
        helperAttempts: 1,
        residentAttempts: 0,
        updatedAt: WARNING_AT,
        simulated: false,
      }),
    );
    expect((await queue(t)).find((h) => h._id === neighbor)?.planReason).toBeUndefined();
  });
});
