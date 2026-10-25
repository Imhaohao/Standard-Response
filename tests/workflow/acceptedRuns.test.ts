/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { buildWorld } from "../../convex/dispatchWorld";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/acceptedRuns.test.ts --environment edge-runtime
// Accepted runs are frozen. An offer the driver accepts after the van took stops from another plan
// joins the run after them, and the planner offers it afresh instead of keeping its old place.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

const VAN = {
  label: "Van 3",
  type: "paratransit" as const,
  driverName: "Luis",
  lat: 34.19,
  lng: -118.15,
  seats: 4,
  wheelchairSpaces: 2,
  stretcherSpaces: 0,
  crewSize: 2,
  liftCapable: true,
  shiftEndsAt: Date.now() + 8 * 3_600_000,
  driverIsSimulated: false,
};

const STREETS = ["1210 Palm St", "1230 Palm St", "1250 Palm St"];

// Riders who need a ride and one van, with every stand-in that would answer for them off.
async function night(t: T) {
  await t.mutation(api.control.reset, {});
  await t.mutation(api.control.setStandIns, { simulateDispatch: false, simulateDrivers: false, autoApprove: false });
  const homes: Id<"households">[] = [];
  for (const [i, address] of STREETS.entries()) {
    const phone = `+1555000010${i}`;
    homes.push(await t.mutation(api.ready.submit, { phone, address, lat: 34.19, lng: -118.155 + i * 0.001, residentName: `Rider ${i}`, language: "en", care: [], exitPlan: "needs_ride", hasCar: false }));
  }
  const vehicleId = await t.run(async (ctx) => await ctx.db.insert("vehicles", VAN));
  await t.mutation(api.control.issueWarning, {});
  for (const householdId of homes) await t.mutation(api.households.update, { householdId, patch: { canLeave: "no" as const } });
  const requests = await t.run(async (ctx) =>
    Promise.all(
      homes.map(async (householdId) => {
        const rows = await ctx.db.query("requests").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).collect();
        return rows.find((r) => r.status === "received")!._id;
      }),
    ),
  );
  return { vehicleId, requests };
}

async function offer(t: T, vehicleId: Id<"vehicles">, stops: { requestId: Id<"requests">; stopOrder: number }[]) {
  const version = await t.mutation(api.plans.propose, {
    solver: "heuristic",
    solveMs: 1,
    offers: stops.map((stop) => ({ ...stop, vehicleId, etaMinutes: 6 })),
    replace: [],
    revoke: [],
  });
  const ids = await t.run(async (ctx) =>
    (await ctx.db.query("assignments").withIndex("by_status", (q) => q.eq("status", "proposed")).collect())
      .filter((a) => a.planVersion === version)
      .map((a) => ({ requestId: a.requestId, id: a._id })),
  );
  for (const { id } of ids) await t.mutation(api.offers.approve, { assignmentId: id });
  return new Map(ids.map(({ requestId, id }) => [requestId, id]));
}

const stopOrderOf = (t: T, assignmentId: Id<"assignments">) => t.run(async (ctx) => (await ctx.db.get("assignments", assignmentId))!.stopOrder);

describe("accepted runs", () => {
  test("an older offer accepted after a newer one joins the run after it", async () => {
    const t = setup();
    const { vehicleId, requests } = await night(t);
    const older = (await offer(t, vehicleId, [{ requestId: requests[0], stopOrder: 0 }])).get(requests[0])!;
    const newer = (await offer(t, vehicleId, [{ requestId: requests[1], stopOrder: 0 }])).get(requests[1])!;
    expect(await t.mutation(api.offers.accept, { assignmentId: newer })).toBe("accepted");
    expect(await t.mutation(api.offers.accept, { assignmentId: older })).toBe("accepted");
    expect(await stopOrderOf(t, newer)).toBe(0);
    expect(await stopOrderOf(t, older)).toBe(1);
  });

  test("offers from one plan keep the order that plan priced, whichever is accepted first", async () => {
    const t = setup();
    const { vehicleId, requests } = await night(t);
    const plan = await offer(t, vehicleId, [
      { requestId: requests[0], stopOrder: 0 },
      { requestId: requests[1], stopOrder: 1 },
    ]);
    await t.mutation(api.offers.accept, { assignmentId: plan.get(requests[1])! });
    await t.mutation(api.offers.accept, { assignmentId: plan.get(requests[0])! });
    expect(await stopOrderOf(t, plan.get(requests[0])!)).toBe(0);
    expect(await stopOrderOf(t, plan.get(requests[1])!)).toBe(1);
  });

  test("the planner offers afresh an open offer the van's accepted run has passed", async () => {
    const t = setup();
    const { vehicleId, requests } = await night(t);
    const older = (await offer(t, vehicleId, [{ requestId: requests[0], stopOrder: 0 }])).get(requests[0])!;
    const newer = (await offer(t, vehicleId, [{ requestId: requests[1], stopOrder: 1 }])).get(requests[1])!;
    const passed = (await offer(t, vehicleId, [{ requestId: requests[2], stopOrder: 2 }])).get(requests[2])!;
    await t.mutation(api.offers.accept, { assignmentId: newer });
    const snap = await t.query(internal.dispatchSnapshot.snapshot, {});
    const world = buildWorld(snap, snap.now);
    expect(world.offers.get(requests[0])?.assignment._id).toBe(older);
    expect(world.offers.get(requests[0])?.stale).toBe(true);
    expect(world.offers.get(requests[2])?.assignment._id).toBe(passed);
    expect(world.offers.get(requests[2])?.stale).toBe(false);
  });
});
