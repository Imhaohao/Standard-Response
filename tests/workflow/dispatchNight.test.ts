/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { vehicleCanServe } from "../../convex/model";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/dispatchNight.test.ts --environment edge-runtime
// The seeded town (200 simulated households, 8 vehicles) through half an hour of the night at 10x,
// with the stand-in voice agent and drivers and the real dispatcher. After every re-plan the
// contract's rules must hold, and riders must reach the shelter.

const modules = import.meta.glob("../../convex/**/*.ts");
const TICK_MS = 900;
const SPEED = 10;

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

type World = {
  assignments: Doc<"assignments">[];
  requests: Doc<"requests">[];
  vehicles: Doc<"vehicles">[];
  shelters: Doc<"shelters">[];
  callbacks: Doc<"callbacks">[];
  plans: Doc<"plans">[];
  state: Doc<"dispatchState"> | null;
};

const read = (t: T): Promise<World> =>
  t.run(async (ctx) => ({
    assignments: await ctx.db.query("assignments").collect(),
    requests: await ctx.db.query("requests").collect(),
    vehicles: await ctx.db.query("vehicles").collect(),
    shelters: await ctx.db.query("shelters").collect(),
    callbacks: await ctx.db.query("callbacks").collect(),
    plans: await ctx.db.query("plans").collect(),
    state: await ctx.db.query("dispatchState").first(),
  }));

const EVER_ACCEPTED = new Set<Doc<"assignments">["status"]>(["accepted", "completed", "revoked"]);

// What a rider hears: one call when a driver accepts, one more only when that pickup is revoked.
function checkCallbacks({ assignments, callbacks, plans }: World) {
  expect(new Set(callbacks.map((c) => c.key)).size).toBe(callbacks.length);
  for (const assignment of assignments) {
    const told = callbacks.filter((c) => c.assignmentId === assignment._id);
    expect(told.filter((c) => c.announces === "driver_accepted").length).toBe(EVER_ACCEPTED.has(assignment.status) ? 1 : 0);
    const reassigning = told.filter((c) => c.announces === "reassigning").length;
    expect(reassigning).toBeLessThanOrEqual(1);
    if (reassigning > 0) expect(assignment.status).toBe("revoked");
  }
  const versions = plans.map((p) => p.version).sort((a, b) => a - b);
  expect(versions).toEqual(versions.map((_, i) => i + 1));
}

function checkContract({ assignments, requests, vehicles, shelters, state, ...rest }: World) {
  checkCallbacks({ assignments, requests, vehicles, shelters, state, ...rest });
  expect(state?.lastError).toBeUndefined();
  const live = assignments.filter((a) => ["proposed", "offered", "accepted"].includes(a.status));
  // One live assignment per request.
  const perRequest = new Map<string, number>();
  for (const a of live) perRequest.set(a.requestId, (perRequest.get(a.requestId) ?? 0) + 1);
  expect([...perRequest.values()].filter((n) => n > 1)).toEqual([]);
  // Every live assignment is to a vehicle that can serve the request.
  const requestById = new Map(requests.map((r) => [r._id as string, r]));
  const vehicleById = new Map(vehicles.map((v) => [v._id as string, v]));
  for (const a of live) expect(vehicleCanServe(vehicleById.get(a.vehicleId)!, requestById.get(a.requestId)!)).toBe(true);
  // A request with an accepted assignment is one a driver accepted.
  for (const a of live.filter((a) => a.status === "accepted")) {
    expect(["driver_accepted", "en_route"]).toContain(requestById.get(a.requestId)!.status);
  }
  // Accepted stops on a vehicle each have their own place in the run.
  for (const vehicle of vehicles) {
    const orders = live.filter((a) => a.vehicleId === vehicle._id && a.status === "accepted").map((a) => a.stopOrder);
    expect(new Set(orders).size).toBe(orders.length);
  }
  for (const shelter of shelters) expect(shelter.occupied ?? 0).toBeLessThanOrEqual(shelter.capacity);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a night in the seeded town with the real dispatcher", () => {
  test("keeps the contract after every re-plan and carries riders to the shelter", { timeout: 600_000 }, async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    await t.mutation(api.control.setStandIns, { simulateDispatch: false, simulateDrivers: true, autoApprove: true, simulateVoice: true });
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.control.setPlayback, { speed: SPEED });
    const generation = (await t.query(api.control.get, {}))!.tickGeneration;
    for (let i = 0; i < 200; i++) {
      vi.advanceTimersByTime(TICK_MS);
      await t.mutation(internal.sim.step, { generation });
      await t.mutation(internal.fleet.tick, { tickMs: TICK_MS * SPEED });
      if (i % 6 === 0) {
        await t.mutation(api.dispatch.replanNow, {});
        await t.action(internal.dispatch.replan, {});
        checkContract(await read(t));
      }
    }
    const world = await read(t);
    checkContract(world);
    // Every accepted pickup that ended without the van reaching the door says why in the audit trail.
    const trail = new Set(await t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).flatMap((a) => (a.kind === "revoked" && a.assignmentId ? [a.assignmentId] : []))));
    for (const a of world.assignments.filter((a) => a.status === "revoked")) expect(trail.has(a._id)).toBe(true);
    const closed = world.requests.filter((r) => r.status === "closed" && world.assignments.some((a) => a.requestId === r._id && a.status === "completed"));
    expect(closed.length).toBeGreaterThan(0);
  });
});
