/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { EDGES, nearestNode, nodePoint } from "../../convex/roadGraph";
import { buildWorld, planFromSolution, solve } from "../../convex/dispatchWorld";
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

describe("an offer nobody answered", () => {
  test("isn't a no: once it has lapsed a while, the same van can be offered the rider again", async () => {
    const t = setup();
    const homes = await night(t);
    const request = await requestOf(t, homes[0]);
    const vans = new Set<Id<"vehicles">>();
    // Every van lets the offer lapse in turn.
    for (let round = 0; round < 4; round++) {
      await replan(t);
      const [offer] = await liveFor(t, request._id);
      if (!offer) break;
      vans.add(offer.vehicleId);
      await t.mutation(internal.offers.expire, { assignmentId: offer._id });
    }
    expect(vans.size).toBe(2);
    await replan(t);
    expect(await liveFor(t, request._id)).toEqual([]);

    // At 10x a minute of the wall clock is ten of the night's, and the drivers still haven't had their five.
    await t.mutation(api.control.setPlayback, { speed: 10 });
    vi.advanceTimersByTime(60_000);
    await replan(t);
    expect(await liveFor(t, request._id)).toEqual([]);

    vi.advanceTimersByTime(7 * 60_000);
    await replan(t);
    const [again] = await liveFor(t, request._id);
    expect(again?.status).toBe("offered");
    expect(vans.has(again.vehicleId)).toBe(true);
  });
});

describe("a solve that takes a while at fast playback", () => {
  test("counts each refreshed ETA from the snapshot it was priced on, not from when the plan landed", async () => {
    const t = setup();
    const homes = await night(t);
    await replan(t);
    const request = await requestOf(t, homes[0]);
    const [offer] = await liveFor(t, request._id);
    await t.mutation(api.offers.accept, { assignmentId: offer._id });
    vi.advanceTimersByTime(2 * 60_000);

    const snap = await t.query(internal.dispatchSnapshot.snapshot, {});
    const world = buildWorld(snap, snap.now);
    const { solution } = await solve(world.problem);
    vi.advanceTimersByTime(3 * 60_000);
    await t.mutation(internal.dispatch.commit, planFromSolution(world, solution));

    const [after] = await liveFor(t, request._id);
    expect(after.etaUpdatedAt).toBe(snap.now);
  });
});

describe("an open offer the new plan keeps on the same van", () => {
  test("stays while its ETA holds, and is offered again with the new ETA when the van will be later", async () => {
    const t = setup();
    const homes = await night(t);
    await replan(t);
    const request = await requestOf(t, homes[0]);
    const [offer] = await liveFor(t, request._id);
    const snap = await t.query(internal.dispatchSnapshot.snapshot, {});
    const world = buildWorld(snap, snap.now);
    const route = (minutes: number) => ({
      routes: [{ vehicle: offer.vehicleId, stops: [{ request: request._id, kind: "pickup" as const, shelter: null, arrival: minutes * 60 }] }],
      dropped: [],
      solver: "heuristic" as const,
      solveMs: 1,
    });

    const holds = planFromSolution(world, route(offer.etaMinutes));
    expect(holds.replace).not.toContain(offer._id);
    expect(holds.offers.map((o) => o.requestId)).not.toContain(request._id);

    const slips = planFromSolution(world, route(offer.etaMinutes + 10));
    expect(slips.replace).toContain(offer._id);
    expect(slips.offers.find((o) => o.requestId === request._id)?.etaMinutes).toBe(offer.etaMinutes + 10);
  });
});

describe("a driver who declined late in a long night", () => {
  test("isn't offered that rider again, however many old refusals came before", { timeout: 30_000 }, async () => {
    const t = setup();
    const homes = await night(t);
    const [rider, other] = await Promise.all(homes.map((home) => requestOf(t, home)));
    // A long night's worth of refusals, all older than tonight's offer.
    await t.run(async (ctx) => {
      const van = (await ctx.db.query("vehicles").first())!;
      const old = { requestId: other._id, householdId: other.householdId, vehicleId: van._id, planVersion: 0, etaMinutes: 5, stopOrder: 0, proposedAt: 0 };
      for (let i = 0; i < 520; i++) await ctx.db.insert("assignments", { ...old, status: "declined" });
    });
    await replan(t);
    const [offer] = await liveFor(t, rider._id);
    await t.mutation(api.offers.decline, { assignmentId: offer._id });
    const snap = await t.query(internal.dispatchSnapshot.snapshot, {});
    const world = buildWorld(snap, snap.now);
    const planned = world.problem.requests.find((r) => r.id === rider._id)!;
    const declined = world.vehicles.findIndex((v) => v._id === offer.vehicleId);
    expect(planned.allowedVehicles).not.toContain(declined);
  });
});

describe("a closure late in a night the fire has crossed", () => {
  test("still cuts the route, however many streets closed before it", { timeout: 60_000 }, async () => {
    const t = setup();
    const homes = await night(t);
    await replan(t);
    const request = await requestOf(t, homes[0]);
    const [offer] = await liveFor(t, request._id);
    await t.mutation(api.offers.accept, { assignmentId: offer._id });
    const corner = new Set(cutOff(HOMES[0]).map((closure) => closure.edgeKey));
    const north = EDGES.filter((edge) => !corner.has(edge.key) && nodePoint(edge.u).lat > 34.196);
    const elsewhere = Array.from({ length: 1100 }, (_, i) => north[i % north.length]);
    await t.run(async (ctx) => {
      for (const edge of elsewhere) {
        await ctx.db.insert("roadClosures", { path: [nodePoint(edge.u), nodePoint(edge.v)], edgeKey: edge.key, edgeKeys: [edge.key], source: "hazard", confirmed: true, at: 0 });
      }
    });
    await replan(t);
    expect((await requestOf(t, homes[0])).status).toBe("driver_accepted");
    await t.mutation(api.roads.addClosures, { closures: cutOff(HOMES[0]) });
    await replan(t);
    expect((await requestOf(t, homes[0])).status).toBe("reassigning");
  });
});

describe("an offer waiting for the dispatcher's approval at fast playback", () => {
  test("stays put for the dispatcher's own two minutes, not two minutes of the night", async () => {
    const t = setup();
    const homes = await night(t);
    await t.mutation(api.control.setStandIns, { autoApprove: false });
    await t.mutation(api.control.setPlayback, { speed: 60 });
    await replan(t);
    const request = await requestOf(t, homes[0]);
    const [proposed] = await liveFor(t, request._id);
    expect(proposed.status).toBe("proposed");

    vi.advanceTimersByTime(10_000);
    await replan(t);
    expect((await liveFor(t, request._id))[0]._id).toBe(proposed._id);

    vi.advanceTimersByTime(150_000);
    await replan(t);
    expect((await liveFor(t, request._id))[0]._id).not.toBe(proposed._id);
  });
});

describe("a route of several trips", () => {
  test("offers its van only the next trip, and plans the rest again next round", async () => {
    const t = setup();
    const homes = await night(t);
    const [first, second] = await Promise.all(homes.map((home) => requestOf(t, home)));
    const snap = await t.query(internal.dispatchSnapshot.snapshot, {});
    const world = buildWorld(snap, snap.now);
    const van = world.vehicles[0]._id;
    const shelter = snap.shelters[0]._id;
    const stop = (request: Id<"requests">, kind: "pickup" | "dropoff", minutes: number) => ({ request, kind, shelter: kind === "dropoff" ? shelter : null, arrival: minutes * 60 });
    const plan = planFromSolution(world, {
      routes: [{ vehicle: van, stops: [stop(first._id, "pickup", 5), stop(first._id, "dropoff", 25), stop(second._id, "pickup", 40), stop(second._id, "dropoff", 60)] }],
      dropped: [],
      solver: "heuristic",
      solveMs: 1,
    });
    expect(plan.offers.map((offer) => offer.requestId)).toEqual([first._id]);
    expect(plan.escalate).toEqual([]);
  });
});

describe("a plan that revokes a pickup", () => {
  test("offers that rider a new van in the same plan", async () => {
    const t = setup();
    const homes = await night(t);
    await replan(t);
    const request = await requestOf(t, homes[0]);
    const [offer] = await liveFor(t, request._id);
    await t.mutation(api.offers.accept, { assignmentId: offer._id });
    const other = (await t.query(api.vehicles.list, {})).find((v) => v._id !== offer.vehicleId)!;
    await t.mutation(internal.dispatch.commit, {
      offers: [{ requestId: request._id, vehicleId: other._id, etaMinutes: 9, sequence: 0 }],
      replace: [],
      revoke: [{ assignmentId: offer._id, reason: "the only open route arrives after their deadline" }],
      etaUpdates: [],
      escalate: [],
      closureEdges: [],
      closuresSeen: 0,
      plannedAt: Date.now(),
      solver: "heuristic",
      solveMs: 1,
      requestCount: 1,
      vehicleCount: 2,
    });
    const [next] = await liveFor(t, request._id);
    expect(next?.vehicleId).toBe(other._id);
    expect(await callbacksFor(t, request._id)).toEqual(["driver_accepted", "reassigning"]);
  });
});
