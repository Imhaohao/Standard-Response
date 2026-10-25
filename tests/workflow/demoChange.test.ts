/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/demoChange.test.ts --environment edge-runtime
// The demo's change moment with the real dispatcher (PLAN.md, the 3-minute script, 1:50): Maria has
// accepted Carmen, Luis has an open offer for Walter. Maria can no longer make it. Carmen is told,
// the next plan gives Luis's van to Carmen, Luis's tap on the old Walter offer is rejected, and his
// accept of Carmen calls her back.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

const CARMEN = { phone: "+15550000301", address: "1210 Palm St", lat: 34.1905, lng: -118.155, residentName: "Carmen", language: "es" };
const WALTER = { phone: "+15550000302", address: "1650 Mariposa St", lat: 34.1935, lng: -118.149, residentName: "Walter", language: "en" };

async function rider(t: T, home: typeof CARMEN) {
  return await t.mutation(api.ready.submit, { ...home, care: [], exitPlan: "needs_ride", hasCar: false });
}

const openRequest = (t: T, householdId: Id<"households">) =>
  t.run(async (ctx) => {
    const rows = await ctx.db.query("requests").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).collect();
    return rows.find((r) => r.status !== "closed")!;
  });

const liveFor = (t: T, requestId: Id<"requests">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("assignments").withIndex("by_requestId", (q) => q.eq("requestId", requestId)).collect()).filter((a) =>
      ["proposed", "offered", "accepted"].includes(a.status),
    ),
  );

const callbacksFor = (t: T, requestId: Id<"requests">) =>
  t.run(async (ctx) => (await ctx.db.query("callbacks").collect()).filter((c) => c.requestId === requestId).map((c) => c.announces));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the demo's change moment", () => {
  test("Carmen's pickup moves to Luis, and his tap on the replaced Walter offer is rejected", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    await t.mutation(api.control.setStandIns, { simulateDispatch: false, simulateDrivers: false, autoApprove: true });
    const carmen = await rider(t, CARMEN);
    const walter = await rider(t, WALTER);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, {
      householdId: carmen,
      patch: { canLeave: "no", peopleCount: 2, mobility: "manual_wheelchair", assistanceRequired: "two_person_lift" },
    });
    await t.mutation(api.households.update, { householdId: walter, patch: { canLeave: "no" } });
    const vans = await t.query(api.vehicles.list, {});
    const maria = vans.find((v) => v.driverName === "Maria")!;
    const luis = vans.find((v) => v.driverName === "Luis")!;
    const carmenRequest = await openRequest(t, carmen);
    const walterRequest = await openRequest(t, walter);

    // The plan before the change: Maria takes Carmen, Luis is offered Walter.
    await t.mutation(api.plans.propose, {
      solver: "alns",
      solveMs: 1,
      offers: [
        { requestId: carmenRequest._id, vehicleId: maria._id, etaMinutes: 6, stopOrder: 0 },
        { requestId: walterRequest._id, vehicleId: luis._id, etaMinutes: 4, stopOrder: 0 },
      ],
      replace: [],
      revoke: [],
    });
    const [mariaCarmen] = await liveFor(t, carmenRequest._id);
    const [luisWalter] = await liveFor(t, walterRequest._id);
    expect(await t.mutation(api.offers.accept, { assignmentId: mariaCarmen._id })).toBe("accepted");

    // Maria can no longer reach Carmen. Carmen hears it right away.
    await t.mutation(api.offers.cancelByDriver, { assignmentId: mariaCarmen._id });
    expect((await openRequest(t, carmen)).status).toBe("reassigning");

    await t.mutation(api.dispatch.replanNow, {});
    await t.action(internal.dispatch.replan, {});

    const [luisCarmen] = await liveFor(t, carmenRequest._id);
    expect(luisCarmen.vehicleId).toBe(luis._id);
    expect(await t.mutation(api.offers.accept, { assignmentId: luisWalter._id })).toBe("changed");
    expect(await t.mutation(api.offers.accept, { assignmentId: luisCarmen._id })).toBe("accepted");
    expect(await callbacksFor(t, carmenRequest._id)).toEqual(["driver_accepted", "reassigning", "driver_accepted"]);
    expect(await callbacksFor(t, walterRequest._id)).toEqual([]);
  });
});
