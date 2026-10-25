/// <reference types="vite/client" />
// Adversarial tests for the driver accept flow: a driver tapping fast on a bad connection.
// Each describe block is one rule from PLAN.md "Rules the contract already enforces".
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { queueCallback } from "./callbacks";
import { OFFER_TTL_MS } from "./model";
import { transitionRequest } from "./requests";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const newTest = () => convexTest(schema, modules);
type T = ReturnType<typeof newTest>;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-25T09:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

async function addRequest(t: T) {
  return await t.run(async (ctx) => {
    const householdId = await ctx.db.insert("households", {
      address: `${Math.floor(Math.random() * 900) + 100} Ridge Rd`,
      callbackNumber: "+15555550100",
      language: "en",
      callStatus: "complete",
      outcome: "needs_ride",
      inZone: true,
      attempts: 1,
      needPrior: 0.1,
      needProbability: 0.9,
      fireArrivalAt: Date.now() + 60 * 60_000,
      callPriority: 1,
      simulated: true,
    });
    const requestId = await ctx.db.insert("requests", {
      householdId,
      status: "received",
      load: { seats: 1, wheelchairSpaces: 0, stretcherSpaces: 0 },
      crewNeeded: 1,
      needsLift: false,
      boardingMinutes: 3,
      deadlineAt: Date.now() + 45 * 60_000,
      weight: 1,
      updatedAt: Date.now(),
    });
    return requestId;
  });
}

async function addVehicle(t: T, label = "Maria's van") {
  return await t.run(async (ctx) =>
    ctx.db.insert("vehicles", {
      label,
      type: "paratransit",
      driverName: label,
      lat: 37.87,
      lng: -122.27,
      seats: 6,
      wheelchairSpaces: 2,
      stretcherSpaces: 0,
      crewSize: 2,
      liftCapable: true,
      shiftEndsAt: Date.now() + 8 * 3600_000,
      driverIsSimulated: false,
    }),
  );
}

type OfferIn = { requestId: Id<"requests">; vehicleId: Id<"vehicles">; stopOrder: number };

async function propose(t: T, offers: OfferIn[], change: { replace?: Id<"assignments">[]; revoke?: Id<"assignments">[] } = {}) {
  return await t.mutation(api.plans.propose, {
    solver: "heuristic",
    solveMs: 1,
    offers: offers.map((o) => ({ ...o, etaMinutes: 7 })),
    replace: change.replace ?? [],
    revoke: change.revoke ?? [],
  });
}

async function assignmentFor(t: T, requestId: Id<"requests">, version: number) {
  const id = await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("assignments")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .collect();
    return rows.find((a) => a.planVersion === version)?._id;
  });
  if (!id) throw new Error("no assignment for that plan");
  return id;
}

// One request, one van, one approved offer the driver can see.
async function openOffer(t: T, stopOrder = 1, vehicleId?: Id<"vehicles">) {
  const requestId = await addRequest(t);
  const van = vehicleId ?? (await addVehicle(t));
  const version = await propose(t, [{ requestId, vehicleId: van, stopOrder }]);
  const assignmentId = await assignmentFor(t, requestId, version);
  await t.mutation(api.offers.approve, { assignmentId });
  return { requestId, vehicleId: van, assignmentId };
}

async function getAssignment(t: T, id: Id<"assignments">) {
  return (await t.run(async (ctx) => ctx.db.get(id)))!;
}

async function getRequest(t: T, id: Id<"requests">) {
  return (await t.run(async (ctx) => ctx.db.get(id)))!;
}

async function callbacksFor(t: T, requestId: Id<"requests">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("callbacks").collect()).filter((c) => c.requestId === requestId),
  );
}

async function auditKinds(t: T) {
  return await t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).map((row) => row.kind));
}

// Everything a stale accept must leave alone. The audit log is compared separately.
async function snapshot(t: T) {
  return await t.run(async (ctx) => ({
    assignments: await ctx.db.query("assignments").collect(),
    requests: await ctx.db.query("requests").collect(),
    callbacks: await ctx.db.query("callbacks").collect(),
    plans: await ctx.db.query("plans").collect(),
    scheduled: (await ctx.db.system.query("_scheduled_functions").collect()).length,
  }));
}

// A stale accept may only add its own audit row. Nothing else moves.
async function expectStaleAccept(t: T, assignmentId: Id<"assignments">) {
  const before = await snapshot(t);
  const auditBefore = await auditKinds(t);
  vi.advanceTimersByTime(1000);
  expect(await t.mutation(api.offers.accept, { assignmentId })).toBe("changed");
  expect(await snapshot(t)).toEqual(before);
  expect(await auditKinds(t)).toEqual([...auditBefore, "stale_accept_rejected"]);
}

async function fireExpiry(t: T) {
  vi.advanceTimersByTime(OFFER_TTL_MS + 1);
  await t.finishInProgressScheduledFunctions();
}

describe("(a) accept only succeeds on an open offer", () => {
  test("accept on an offer the plan replaced returns changed and changes nothing", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    const otherVan = await addVehicle(t, "Luis's van");
    await propose(t, [{ requestId, vehicleId: otherVan, stopOrder: 1 }], { replace: [assignmentId] });
    expect((await getAssignment(t, assignmentId)).status).toBe("replaced");
    await expectStaleAccept(t, assignmentId);
  });

  test("accept after the 2-minute expiry fires returns changed and changes nothing", async () => {
    const t = newTest();
    const { assignmentId } = await openOffer(t);
    await fireExpiry(t);
    expect((await getAssignment(t, assignmentId)).status).toBe("expired");
    await expectStaleAccept(t, assignmentId);
  });

  test("decline then accept returns changed and changes nothing", async () => {
    const t = newTest();
    const { assignmentId } = await openOffer(t);
    await t.mutation(api.offers.decline, { assignmentId });
    expect((await getAssignment(t, assignmentId)).status).toBe("declined");
    await expectStaleAccept(t, assignmentId);
  });

  test("accept on a revoked offer returns changed and changes nothing", async () => {
    const t = newTest();
    const { assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    await t.mutation(api.offers.cancelByDriver, { assignmentId });
    expect((await getAssignment(t, assignmentId)).status).toBe("revoked");
    await expectStaleAccept(t, assignmentId);
  });

  test("accept on an offer the dispatcher has not approved yet returns changed", async () => {
    const t = newTest();
    const requestId = await addRequest(t);
    const van = await addVehicle(t);
    const assignmentId = await assignmentFor(t, requestId, await propose(t, [{ requestId, vehicleId: van, stopOrder: 1 }]));
    await expectStaleAccept(t, assignmentId);
  });

  test("the expiry that fires after an accept leaves the accepted pickup alone", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    await fireExpiry(t);
    expect((await getAssignment(t, assignmentId)).status).toBe("accepted");
    expect((await getRequest(t, requestId)).status).toBe("driver_accepted");
  });
});

describe("(b) exactly one callback per acceptance", () => {
  test("double Accept on the same offer: one callback, and the retry is told it succeeded", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    expect(await t.mutation(api.offers.accept, { assignmentId })).toBe("accepted");
    const before = await snapshot(t);
    const auditBefore = await auditKinds(t);
    // The response to the first tap was lost; the phone sends Accept again.
    expect(await t.mutation(api.offers.accept, { assignmentId })).toBe("accepted");
    expect(await snapshot(t)).toEqual(before);
    expect(await auditKinds(t)).toEqual(auditBefore);
    const callbacks = await callbacksFor(t, requestId);
    expect(callbacks.map((c) => c.announces)).toEqual(["driver_accepted"]);
  });

  test("two Accepts in flight at once queue one callback", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    const results = await Promise.all([
      t.mutation(api.offers.accept, { assignmentId }),
      t.mutation(api.offers.accept, { assignmentId }),
    ]);
    expect(results).toEqual(["accepted", "accepted"]);
    expect((await callbacksFor(t, requestId)).map((c) => c.announces)).toEqual(["driver_accepted"]);
    expect((await auditKinds(t)).filter((k) => k === "accepted")).toHaveLength(1);
  });

  test("a duplicate callback event for the same acceptance is logged and ignored", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    const [first] = await callbacksFor(t, requestId);
    const again = await t.run(async (ctx) => queueCallback(ctx, (await ctx.db.get(assignmentId))!, "driver_accepted"));
    expect(again).toBe(first._id);
    expect(await callbacksFor(t, requestId)).toEqual([first]);
    expect(await auditKinds(t)).toContain("callback_duplicate");
  });
});

describe("(b) duplicate callback events from the voice server", () => {
  async function playedCallback(t: T) {
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    const [callback] = await callbacksFor(t, requestId);
    await t.mutation(api.callbacks.markPlaced, { callbackId: callback._id });
    vi.advanceTimersByTime(4000);
    await t.mutation(api.callbacks.markPlayed, { callbackId: callback._id });
    return (await t.run(async (ctx) => ctx.db.get(callback._id)))!;
  }

  test("a repeated markPlayed keeps the first playedAt", async () => {
    const t = newTest();
    const played = await playedCallback(t);
    vi.advanceTimersByTime(9000);
    await t.mutation(api.callbacks.markPlayed, { callbackId: played._id });
    expect(await t.run(async (ctx) => ctx.db.get(played._id))).toEqual(played);
  });

  test("a late markPlaced or markUnanswered can't undo a played callback", async () => {
    const t = newTest();
    const played = await playedCallback(t);
    vi.advanceTimersByTime(9000);
    await t.mutation(api.callbacks.markPlaced, { callbackId: played._id });
    await t.mutation(api.callbacks.markUnanswered, { callbackId: played._id });
    expect(await t.run(async (ctx) => ctx.db.get(played._id))).toEqual(played);
  });

  test("an unanswered callback can still be placed again (the retry ladder)", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    const [callback] = await callbacksFor(t, requestId);
    await t.mutation(api.callbacks.markPlaced, { callbackId: callback._id });
    await t.mutation(api.callbacks.markUnanswered, { callbackId: callback._id });
    await t.mutation(api.callbacks.markPlaced, { callbackId: callback._id });
    await t.mutation(api.callbacks.markPlayed, { callbackId: callback._id });
    expect((await t.run(async (ctx) => ctx.db.get(callback._id)))!.state).toBe("played");
  });
});

describe("(c) an offer that ends before acceptance releases the request silently", () => {
  test("expiry sends the request back to received with no callback", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    expect((await getRequest(t, requestId)).status).toBe("approved");
    await fireExpiry(t);
    expect((await getAssignment(t, assignmentId)).status).toBe("expired");
    expect((await getRequest(t, requestId)).status).toBe("received");
    expect(await callbacksFor(t, requestId)).toEqual([]);
  });

  test("decline sends the request back to received with no callback", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.decline, { assignmentId });
    await t.mutation(api.offers.decline, { assignmentId });
    expect((await getRequest(t, requestId)).status).toBe("received");
    expect(await callbacksFor(t, requestId)).toEqual([]);
  });

  test("a plan replacing the offer sends the request back to received with no callback", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await propose(t, [], { replace: [assignmentId] });
    expect((await getAssignment(t, assignmentId)).status).toBe("replaced");
    expect((await getRequest(t, requestId)).status).toBe("received");
    expect(await callbacksFor(t, requestId)).toEqual([]);
  });

  test("cancelByDriver before accepting is a silent release, not a revoke", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.cancelByDriver, { assignmentId });
    expect((await getRequest(t, requestId)).status).toBe("received");
    expect(await callbacksFor(t, requestId)).toEqual([]);
  });

  test("the expiry scheduled for a replaced offer does nothing to its successor", async () => {
    const t = newTest();
    const { requestId, vehicleId, assignmentId } = await openOffer(t);
    vi.advanceTimersByTime(OFFER_TTL_MS / 2);
    const version = await propose(t, [{ requestId, vehicleId, stopOrder: 1 }], { replace: [assignmentId] });
    const successor = await assignmentFor(t, requestId, version);
    await t.mutation(api.offers.approve, { assignmentId: successor });
    vi.advanceTimersByTime(OFFER_TTL_MS / 2 + 1);
    await t.finishInProgressScheduledFunctions();
    expect((await getAssignment(t, successor)).status).toBe("offered");
    expect(await t.mutation(api.offers.accept, { assignmentId: successor })).toBe("accepted");
  });

  test("a replacement offer that expires after a revoke leaves the rider in reassigning, uncalled", async () => {
    // reassigning can only move to driver_accepted or closed; the rider was already told "no driver yet".
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    await t.mutation(api.offers.cancelByDriver, { assignmentId });
    const otherVan = await addVehicle(t, "Luis's van");
    const second = await assignmentFor(t, requestId, await propose(t, [{ requestId, vehicleId: otherVan, stopOrder: 1 }]));
    await t.mutation(api.offers.approve, { assignmentId: second });
    const callbacksBefore = await callbacksFor(t, requestId);
    await fireExpiry(t);
    expect((await getAssignment(t, second)).status).toBe("expired");
    expect((await getRequest(t, requestId)).status).toBe("reassigning");
    expect(await callbacksFor(t, requestId)).toEqual(callbacksBefore);
  });
});

describe("(d) an accepted run never gets new stops before its last accepted drop-off", () => {
  async function acceptedRun(t: T) {
    const first = await openOffer(t, 3);
    await t.mutation(api.offers.accept, { assignmentId: first.assignmentId });
    return first;
  }

  test("plans:propose refuses a stop before the last accepted one, and writes nothing", async () => {
    const t = newTest();
    const { vehicleId } = await acceptedRun(t);
    const later = await addRequest(t);
    const before = await snapshot(t);
    for (const stopOrder of [1, 3]) {
      await expect(propose(t, [{ requestId: later, vehicleId, stopOrder }])).rejects.toThrow(/accepted run/);
    }
    expect(await snapshot(t)).toEqual(before);
  });

  test("a refused stop rolls back the whole plan, including its replacements", async () => {
    const t = newTest();
    const { vehicleId } = await acceptedRun(t);
    const open = await openOffer(t, 5, vehicleId);
    const later = await addRequest(t);
    const before = await snapshot(t);
    await expect(propose(t, [{ requestId: later, vehicleId, stopOrder: 2 }], { replace: [open.assignmentId] })).rejects.toThrow();
    expect(await snapshot(t)).toEqual(before);
  });

  test("an older plan's offer accepted after a later stop joins the run after it", async () => {
    // Two plans each offered one van a stop: stop 2, then stop 1. The driver taps the stop-2 card, then the stop-1 card.
    const t = newTest();
    const later = await openOffer(t, 2);
    const earlier = await openOffer(t, 1, later.vehicleId);
    expect(await t.mutation(api.offers.accept, { assignmentId: later.assignmentId })).toBe("accepted");
    expect(await t.mutation(api.offers.accept, { assignmentId: earlier.assignmentId })).toBe("accepted");
    expect((await getAssignment(t, later.assignmentId)).stopOrder).toBe(2);
    expect((await getAssignment(t, earlier.assignmentId)).stopOrder).toBe(3);
    expect(await callbacksFor(t, earlier.requestId)).toHaveLength(1);
  });

  test("accepting offers in stop order works", async () => {
    const t = newTest();
    const first = await openOffer(t, 1);
    const second = await openOffer(t, 2, first.vehicleId);
    expect(await t.mutation(api.offers.accept, { assignmentId: first.assignmentId })).toBe("accepted");
    expect(await t.mutation(api.offers.accept, { assignmentId: second.assignmentId })).toBe("accepted");
  });
});

describe("(e) a driver cancelling an accepted pickup: reassigning and exactly one callback", () => {
  async function reassigningCallbacks(t: T, requestId: Id<"requests">) {
    return (await callbacksFor(t, requestId)).filter((c) => c.announces === "reassigning");
  }

  test("cancel after accept: reassigning, one reassigning callback", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    await t.mutation(api.offers.cancelByDriver, { assignmentId });
    expect((await getRequest(t, requestId)).status).toBe("reassigning");
    expect(await reassigningCallbacks(t, requestId)).toHaveLength(1);
  });

  test("cancel tapped twice still calls the rider once", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    await Promise.all([
      t.mutation(api.offers.cancelByDriver, { assignmentId }),
      t.mutation(api.offers.cancelByDriver, { assignmentId }),
    ]);
    await t.mutation(api.offers.cancelByDriver, { assignmentId });
    expect((await getRequest(t, requestId)).status).toBe("reassigning");
    expect(await reassigningCallbacks(t, requestId)).toHaveLength(1);
  });

  test("cancel while en route: reassigning, one reassigning callback", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    await t.run(async (ctx) => {
      await transitionRequest(ctx, requestId, "en_route");
    });
    await t.mutation(api.offers.cancelByDriver, { assignmentId });
    expect((await getRequest(t, requestId)).status).toBe("reassigning");
    expect(await reassigningCallbacks(t, requestId)).toHaveLength(1);
  });

  test("Accept racing cancelByDriver, cancel lands first: silent release, then changed", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.cancelByDriver, { assignmentId });
    expect(await t.mutation(api.offers.accept, { assignmentId })).toBe("changed");
    expect((await getRequest(t, requestId)).status).toBe("received");
    expect(await callbacksFor(t, requestId)).toEqual([]);
  });

  test("Accept racing cancelByDriver, both in flight: the outcome is one of the two legal ones", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    const [accepted] = await Promise.all([
      t.mutation(api.offers.accept, { assignmentId }),
      t.mutation(api.offers.cancelByDriver, { assignmentId }),
    ]);
    const request = await getRequest(t, requestId);
    const announces = (await callbacksFor(t, requestId)).map((c) => c.announces).sort();
    if (accepted === "accepted") {
      expect(request.status).toBe("reassigning");
      expect(announces).toEqual(["driver_accepted", "reassigning"]);
    } else {
      expect(request.status).toBe("received");
      expect(announces).toEqual([]);
    }
  });

  test("a late Accept retry after cancelling changes nothing and calls no one", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    await t.mutation(api.offers.cancelByDriver, { assignmentId });
    await expectStaleAccept(t, assignmentId);
    expect((await getRequest(t, requestId)).status).toBe("reassigning");
    expect(await reassigningCallbacks(t, requestId)).toHaveLength(1);
  });

  test("a new driver after reassigning, who also cancels, gets the rider exactly one more call", async () => {
    const t = newTest();
    const { requestId, assignmentId } = await openOffer(t);
    await t.mutation(api.offers.accept, { assignmentId });
    await t.mutation(api.offers.cancelByDriver, { assignmentId });
    const otherVan = await addVehicle(t, "Luis's van");
    const second = await assignmentFor(t, requestId, await propose(t, [{ requestId, vehicleId: otherVan, stopOrder: 1 }]));
    await t.mutation(api.offers.approve, { assignmentId: second });
    expect(await t.mutation(api.offers.accept, { assignmentId: second })).toBe("accepted");
    expect((await getRequest(t, requestId)).status).toBe("driver_accepted");
    await t.mutation(api.offers.cancelByDriver, { assignmentId: second });
    await t.mutation(api.offers.cancelByDriver, { assignmentId: second });
    expect((await getRequest(t, requestId)).status).toBe("reassigning");
    expect(await reassigningCallbacks(t, requestId)).toHaveLength(2);
  });
});

// Keeps `internal` referenced for readers looking for the expiry entry point.
void internal.offers.expire;
