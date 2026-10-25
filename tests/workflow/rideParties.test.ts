/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// Run with: npx vitest run tests/workflow/rideParties.test.ts --environment edge-runtime
// A home no one vehicle can carry rides as two parties: the bedbound patient in the ambulance, the
// rest of the family in a van. A correction that lets one vehicle carry everyone merges them again.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "householdsByOutcome");
  aggregateTest.register(t, "householdsByCallStatus");
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

const HOME = { phone: "+15550000001", address: "1210 Palm St", lat: 34.19, lng: -118.155, residentName: "Wen" };
const VEHICLE = { lat: 34.19, lng: -118.15, crewSize: 2, liftCapable: true, shiftEndsAt: Date.now() + 8 * 3_600_000, driverIsSimulated: true };
const VAN = { ...VEHICLE, label: "Van 3", type: "paratransit" as const, driverName: "Luis", seats: 4, wheelchairSpaces: 2, stretcherSpaces: 0 };
const AMBULANCE = { ...VEHICLE, label: "Medic 41", type: "ambulance" as const, driverName: "Rosa", seats: 1, wheelchairSpaces: 0, stretcherSpaces: 1 };

async function bedboundHome(t: T, peopleCount: number) {
  await t.mutation(api.control.reset, {});
  const home = await t.mutation(api.ready.submit, { ...HOME, language: "en", care: [], exitPlan: "needs_ride", hasCar: false });
  await t.run(async (ctx) => {
    await ctx.db.insert("vehicles", VAN);
    await ctx.db.insert("vehicles", AMBULANCE);
  });
  await t.mutation(api.control.issueWarning, {});
  const patch = { canLeave: "no" as const, mobility: "bedbound" as const, assistanceRequired: "two_person_lift" as const, peopleCount };
  await t.mutation(api.households.update, { householdId: home, patch });
  return home;
}

const openRequests = (t: T, householdId: Id<"households">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("requests").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).collect())
      .filter((r) => r.status !== "closed")
      .map((r) => ({ party: r.party, load: r.load, crewNeeded: r.crewNeeded })),
  );

describe("ride parties", () => {
  test("a bedbound patient with three family members rides in the ambulance with one, and a van takes two", async () => {
    const t = setup();
    const home = await bedboundHome(t, 4);
    expect(await openRequests(t, home)).toEqual([
      { party: "patient", load: { seats: 1, wheelchairSpaces: 0, stretcherSpaces: 1 }, crewNeeded: 2 },
      { party: "companions", load: { seats: 2, wheelchairSpaces: 0, stretcherSpaces: 0 }, crewNeeded: 1 },
    ]);
  });

  test("a bedbound patient with one family member rides whole in the ambulance", async () => {
    const t = setup();
    const home = await bedboundHome(t, 2);
    expect(await openRequests(t, home)).toEqual([
      { party: undefined, load: { seats: 1, wheelchairSpaces: 0, stretcherSpaces: 1 }, crewNeeded: 2 },
    ]);
  });

  test("a correction to two people merges the parties back into the patient's request", async () => {
    const t = setup();
    const home = await bedboundHome(t, 4);
    await t.mutation(api.households.update, { householdId: home, patch: { peopleCount: 2 } });
    expect(await openRequests(t, home)).toEqual([
      { party: undefined, load: { seats: 1, wheelchairSpaces: 0, stretcherSpaces: 1 }, crewNeeded: 2 },
    ]);
  });
});
