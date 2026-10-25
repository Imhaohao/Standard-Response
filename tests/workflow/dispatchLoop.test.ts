/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { EDGES, nearestNode, nodePoint } from "../../convex/roadGraph";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/dispatchLoop.test.ts --environment edge-runtime
// The real dispatcher end to end, with the heuristic (no solver service): a re-plan offers each rider
// a compatible van, the driver accepts, the van drives the road graph to the door and on to the shelter.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

const TICK_MS = 900;

const HOMES = [
  { address: "1210 Palm St", lat: 34.1905, lng: -118.155 },
  { address: "1650 Mariposa St", lat: 34.1935, lng: -118.149 },
];

async function night(t: T) {
  await t.mutation(api.control.reset, {});
  await t.mutation(api.control.setStandIns, { simulateDispatch: false, simulateDrivers: false, autoApprove: true });
  const homes: Id<"households">[] = [];
  for (const [i, home] of HOMES.entries()) {
    const signUp = { ...home, phone: `+1555000020${i}`, residentName: `Rider ${i}`, language: "en", care: [], exitPlan: "needs_ride" as const, hasCar: false };
    homes.push(await t.mutation(api.ready.submit, signUp));
  }
  await t.mutation(api.control.issueWarning, {});
  for (const householdId of homes) await t.mutation(api.households.update, { householdId, patch: { canLeave: "no" as const } });
  return homes;
}

const requestOf = (t: T, householdId: Id<"households">) =>
  t.run(async (ctx) => {
    const rows = await ctx.db.query("requests").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).collect();
    return rows[rows.length - 1];
  });

const liveFor = (t: T, requestId: Id<"requests">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("assignments").withIndex("by_requestId", (q) => q.eq("requestId", requestId)).collect()).filter((a) =>
      ["proposed", "offered", "accepted"].includes(a.status),
    ),
  );

async function replan(t: T) {
  await t.mutation(api.dispatch.replanNow, {});
  await t.action(internal.dispatch.replan, {});
}

async function tick(t: T, count: number) {
  for (let i = 0; i < count; i++) {
    vi.advanceTimersByTime(TICK_MS);
    await t.mutation(internal.fleet.tick, { tickMs: TICK_MS });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the real dispatcher", () => {
  test("offers every rider a van, and an accepted van carries them to the shelter", async () => {
    const t = setup();
    const homes = await night(t);
    await replan(t);
    const requests = await Promise.all(homes.map((home) => requestOf(t, home)));
    for (const request of requests) {
      const [offer] = await liveFor(t, request._id);
      expect(offer?.status).toBe("offered");
      expect(await t.mutation(api.offers.accept, { assignmentId: offer._id })).toBe("accepted");
    }
    for (let i = 0; i < 60; i++) {
      await tick(t, 100);
      const statuses = await Promise.all(homes.map(async (home) => (await requestOf(t, home)).status));
      if (statuses.every((status) => status === "closed")) break;
    }
    expect(await Promise.all(homes.map(async (home) => (await requestOf(t, home)).status))).toEqual(["closed", "closed"]);
    const [shelter] = await t.query(api.vehicles.shelters, {});
    expect(shelter.occupied).toBe(2);
    // The van reaches the door when the rider was told it would, on the night's clock.
    const pickups = await t.run(async (ctx) => (await ctx.db.query("assignments").collect()).filter((a) => a.status === "completed"));
    for (const pickup of pickups) {
      const tookMinutes = (pickup.completedAt! - pickup.respondedAt!) / 60_000;
      expect(Math.abs(tookMinutes - pickup.etaMinutes)).toBeLessThan(2);
    }
  });
});

// Every street segment that touches the corner nearest this point.
function cutOff(point: { lat: number; lng: number }) {
  const node = nearestNode(point);
  return EDGES.flatMap((edge) =>
    edge.u === node || edge.v === node ? [{ edgeKey: edge.key, path: [nodePoint(edge.u), nodePoint(edge.v)], source: "manual" as const }] : [],
  );
}

const callbacksFor = (t: T, requestId: Id<"requests">) =>
  t.run(async (ctx) => (await ctx.db.query("callbacks").collect()).filter((c) => c.requestId === requestId).map((c) => c.announces));

describe("a closure after the driver accepted", () => {
  test("revokes only the pickup no road reaches, tells that rider, and leaves the rest of the run alone", async () => {
    const t = setup();
    const homes = await night(t);
    await replan(t);
    const [stranded, other] = await Promise.all(homes.map((home) => requestOf(t, home)));
    const offers = [...(await liveFor(t, stranded._id)), ...(await liveFor(t, other._id))];
    for (const offer of offers) await t.mutation(api.offers.accept, { assignmentId: offer._id });
    const otherBefore = (await liveFor(t, other._id))[0];

    await t.mutation(api.roads.addClosures, { closures: cutOff(HOMES[0]) });
    await replan(t);

    expect((await requestOf(t, homes[0])).status).toBe("reassigning");
    expect(await callbacksFor(t, stranded._id)).toEqual(["driver_accepted", "reassigning"]);
    expect(await liveFor(t, stranded._id)).toEqual([]);
    const otherAfter = (await liveFor(t, other._id))[0];
    expect(otherAfter._id).toBe(otherBefore._id);
    expect(otherAfter.status).toBe("accepted");
    expect(otherAfter.stopOrder).toBe(otherBefore.stopOrder);
  });
});

describe("a closure lifted and another started between two ticks", () => {
  test("still sends the van around the new one and re-plans", async () => {
    const t = setup();
    const homes = await night(t);
    await replan(t);
    const request = await requestOf(t, homes[0]);
    const [offer] = await liveFor(t, request._id);
    await t.mutation(api.offers.accept, { assignmentId: offer._id });
    // A closure far from the run, snapped by a re-plan, so the van's path is planned around it.
    const far = EDGES.find((edge) => nodePoint(edge.u).lat > 34.199)!;
    await t.mutation(api.roads.addClosures, { closures: [{ edgeKey: far.key, path: [nodePoint(far.u), nodePoint(far.v)], source: "manual" }] });
    await replan(t);
    await tick(t, 1);
    const before = await t.run(async (ctx) => (await ctx.db.query("vehicleRoutes").collect()).find((r) => r.vehicleId === offer.vehicleId)!);

    // One batch lifts the far closure and closes every street at the rider's corner, already snapped.
    const corner = cutOff(HOMES[0]).map((closure) => closure.edgeKey);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("roadClosures").collect()) await ctx.db.delete("roadClosures", row._id);
      await ctx.db.insert("roadClosures", { path: [nodePoint(nearestNode(HOMES[0]))], source: "manual", edgeKeys: corner, confirmed: true, at: Date.now() });
    });
    await tick(t, 1);

    const after = await t.run(async (ctx) => (await ctx.db.query("vehicleRoutes").collect()).find((r) => r.vehicleId === offer.vehicleId)!);
    expect(after.closuresSeen).not.toBe(before.closuresSeen);
    expect(after.legSeconds).toEqual([]);
    const state = await t.run(async (ctx) => await ctx.db.query("dispatchState").first());
    expect(state?.replanStartedAt).toBeDefined();
  });
});

describe("a driver who can't make it", () => {
  test("the rider is told, the next plan offers another van, and its driver's accept is announced", async () => {
    const t = setup();
    const homes = await night(t);
    await replan(t);
    const request = await requestOf(t, homes[0]);
    const [first] = await liveFor(t, request._id);
    await t.mutation(api.offers.accept, { assignmentId: first._id });
    await t.mutation(api.offers.cancelByDriver, { assignmentId: first._id });
    expect((await requestOf(t, homes[0])).status).toBe("reassigning");

    await replan(t);
    const [second] = await liveFor(t, request._id);
    expect(second.status).toBe("offered");
    expect(second.vehicleId).not.toBe(first.vehicleId);
    expect(await t.mutation(api.offers.accept, { assignmentId: second._id })).toBe("accepted");
    expect((await requestOf(t, homes[0])).status).toBe("driver_accepted");
    expect(await callbacksFor(t, request._id)).toEqual(["driver_accepted", "reassigning", "driver_accepted"]);
  });
});
