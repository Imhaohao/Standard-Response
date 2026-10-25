// Each scenario sets up its own riders, fires conflicting writes all at once from many clients, then
// checks the contract from the tables. Convex runs each mutation as one serializable transaction,
// so what can break is logic that spans transactions, reads that stop early, and idempotency.

import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { RecordPatch } from "../../convex/households";
import { asPublic, conflictTable, countBy, Lab, Outcome, plan, shuffle } from "./lab";
import { checkAcceptReturns, checkContract, checkPlanVersions, liveFor, callbacksFor, snapshot } from "./invariants";

export type World = { vehicles: Doc<"vehicles">[] };
export type Scenario = { name: string; about: string; run: (lab: Lab, world: World) => Promise<void> };

const expire = asPublic(internal.offers.expire);
const commit = asPublic(internal.dispatch.commit);

// Refusals the contract is meant to give; any other error is a bug. Write conflicts Convex gave up
// on are counted apart (Lab.conflicts): the write failed whole, so they can't break an invariant.
const EXPECTED_REFUSAL = /already has a live assignment|accepted run can't take new stops|can't serve request|can't take an offer/;
const NONE = /^$/;

function unexpectedErrors(lab: Lab, results: Outcome<unknown>[], allowed = EXPECTED_REFUSAL) {
  const errors = results.flatMap((r) => (r.ok || allowed.test(r.error) || conflictTable(r.error) ? [] : [r.error]));
  const kinds = countBy(errors, (e) => e.replace(/[a-z0-9]{32}/g, "<id>"));
  lab.expect(errors.length === 0, `no unexpected errors (${errors.length}: ${JSON.stringify(kinds)})`);
}

const refusedWith = (result: Outcome<unknown>, reason: RegExp) => !result.ok && reason.test(result.error);
const describe = (result: Outcome<unknown>) => (result.ok ? "let through" : result.error);

const crewOf = (world: World, crew: number) => world.vehicles.filter((v) => v.crewSize === crew);
const pick = <T>(items: T[], i: number) => items[i % items.length];

async function requests(lab: Lab, tag: string, count: number) {
  const households = await lab.riders(tag, count);
  const ids = await Promise.all(households.map((h) => lab.rideRequest(h)));
  return ids.map((requestId, i) => ({ householdId: households[i], requestId }));
}

async function offered(lab: Lab, world: World, tag: string, count: number, vehicles = world.vehicles) {
  const rows = await requests(lab, tag, count);
  return await Promise.all(rows.map(async (row, i) => ({ ...row, vehicleId: pick(vehicles, i)._id, assignmentId: await lab.offer(row.requestId, pick(vehicles, i)._id) })));
}

type AcceptCall = { assignmentId: Id<"assignments">; result: Outcome<"accepted" | "changed"> };

function acceptWins(calls: AcceptCall[], all: Id<"assignments">[]) {
  const wins = new Map(all.map((id) => [id, 0]));
  for (const call of calls) if (call.result.ok && call.result.value === "accepted") wins.set(call.assignmentId, (wins.get(call.assignmentId) ?? 0) + 1);
  return wins;
}

// Fires every operation at once, in random order, and keeps each accept's answer.
async function storm(ops: (() => Promise<Outcome<unknown>>)[]) {
  return await Promise.all(shuffle(ops).map((op) => op()));
}

const acceptOp = (lab: Lab, assignmentId: Id<"assignments">, calls: AcceptCall[]) => async () => {
  const result = await lab.mutate(api.offers.accept, { assignmentId });
  calls.push({ assignmentId, result });
  return result;
};

const doubleAccept: Scenario = {
  name: "double-accept",
  about: "25 open offers, each accepted by 12 phones at once",
  run: async (lab, world) => {
    const rows = await offered(lab, world, "dbl", 25);
    const calls: AcceptCall[] = [];
    const results = await storm(rows.flatMap((row) => Array.from({ length: 12 }, () => acceptOp(lab, row.assignmentId, calls))));
    unexpectedErrors(lab, results);
    const snap = await snapshot(lab);
    const wins = acceptWins(calls, rows.map((r) => r.assignmentId));
    for (const row of rows) lab.expect(wins.get(row.assignmentId) === 1, `offer ${row.assignmentId} accepted exactly once (${wins.get(row.assignmentId)})`);
    checkAcceptReturns(lab, snap, wins);
    checkContract(lab, snap, new Set(rows.map((r) => r.requestId)));
  },
};

type Row = { requestId: Id<"requests">; householdId: Id<"households">; assignmentId: Id<"assignments"> };

// Final request status that matches the assignment's final status.
const EXPECTED_REQUEST: Partial<Record<Doc<"assignments">["status"], Doc<"requests">["status"]>> = {
  accepted: "driver_accepted",
  revoked: "reassigning",
  declined: "received",
  expired: "received",
  replaced: "received",
};

function checkEndings(lab: Lab, snap: Awaited<ReturnType<typeof snapshot>>, rows: Row[]) {
  const byId = new Map(snap.assignments.map((a) => [a._id, a]));
  for (const row of rows) {
    const status = byId.get(row.assignmentId)!.status;
    const request = snap.requests.get(row.requestId)!;
    lab.expect(request.status === EXPECTED_REQUEST[status], `request ${row.requestId} is ${EXPECTED_REQUEST[status]} after its offer ended ${status} (is ${request.status})`);
  }
}

const acceptVersusEnd: Scenario = {
  name: "accept-vs-end",
  about: "30 open offers; at once on each: 3 accepts, 2 declines, 2 expiry timers, 2 re-plans replacing it, 1 driver cancel",
  run: async (lab, world) => {
    const rows = await offered(lab, world, "end", 30);
    const calls: AcceptCall[] = [];
    const ops = rows.flatMap(({ assignmentId }) => [
      ...Array.from({ length: 3 }, () => acceptOp(lab, assignmentId, calls)),
      ...Array.from({ length: 2 }, () => () => lab.mutate(api.offers.decline, { assignmentId })),
      ...Array.from({ length: 2 }, () => () => lab.mutate(expire, { assignmentId })),
      ...Array.from({ length: 2 }, () => () => lab.mutate(api.plans.propose, plan([], [assignmentId]))),
      () => lab.mutate(api.offers.cancelByDriver, { assignmentId }),
    ]);
    unexpectedErrors(lab, await storm(ops));
    const snap = await snapshot(lab);
    checkAcceptReturns(lab, snap, acceptWins(calls, rows.map((r) => r.assignmentId)));
    checkEndings(lab, snap, rows);
    checkContract(lab, snap, new Set(rows.map((r) => r.requestId)));
    checkPlanVersions(lab, snap);
  },
};

const cancelStorm: Scenario = {
  name: "cancel-storm",
  about: "15 accepted pickups; at once on each: 8 'Can't make it' taps and 4 late accepts",
  run: async (lab, world) => {
    // Every offer exists before any accept, or a later offer would land behind an accepted stop.
    const rows = await offered(lab, world, "cxl", 15);
    const accepted = await Promise.all(rows.map((row) => lab.accept(row.assignmentId)));
    const calls: AcceptCall[] = [];
    const ops = accepted.flatMap((assignmentId) => [
      ...Array.from({ length: 8 }, () => () => lab.mutate(api.offers.cancelByDriver, { assignmentId })),
      ...Array.from({ length: 4 }, () => acceptOp(lab, assignmentId, calls)),
    ]);
    unexpectedErrors(lab, await storm(ops));
    const snap = await snapshot(lab);
    lab.expect(calls.every((c) => c.result.ok && c.result.value === "changed"), "every late accept on a cancelled pickup answers \"changed\"");
    for (const [i, assignmentId] of accepted.entries()) {
      lab.expect(callbacksFor(snap, assignmentId, "reassigning").length === 1, `rider ${rows[i].requestId} is called about the cancellation exactly once`);
      lab.expect(snap.requests.get(rows[i].requestId)?.status === "reassigning", `request ${rows[i].requestId} is reassigning`);
    }
    checkContract(lab, snap, new Set(rows.map((r) => r.requestId)));
  },
};

const proposeRace: Scenario = {
  name: "propose-race",
  about: "8 dispatchers offer each of 20 waiting requests at once, then 6 dispatchers send whole plans for 10 more",
  run: async (lab, world) => {
    const single = await requests(lab, "prs", 20);
    const singleOps = single.flatMap(({ requestId }, i) =>
      Array.from({ length: 8 }, (_, d) => () =>
        lab.mutate(api.plans.propose, plan([{ requestId, vehicleId: pick(world.vehicles, i + d)._id, etaMinutes: 5, stopOrder: lab.stopOrder() }])),
      ),
    );
    const singleResults = await storm(singleOps);
    unexpectedErrors(lab, singleResults);
    lab.expect(singleResults.filter((r) => r.ok).length === single.length, `exactly one offer per request got through (${singleResults.filter((r) => r.ok).length} of ${single.length})`);

    const whole = await requests(lab, "prw", 10);
    const planOps = Array.from({ length: 6 }, (_, d) => () =>
      lab.mutate(api.plans.propose, plan(whole.map(({ requestId }, i) => ({ requestId, vehicleId: pick(world.vehicles, i + d)._id, etaMinutes: 5, stopOrder: lab.stopOrder() })))),
    );
    const planResults = await storm(planOps);
    unexpectedErrors(lab, planResults);
    lab.expect(planResults.filter((r) => r.ok).length === 1, `exactly one whole plan got through (${planResults.filter((r) => r.ok).length})`);

    const snap = await snapshot(lab);
    for (const { requestId } of [...single, ...whole]) lab.expect(liveFor(snap, requestId).length === 1, `request ${requestId} has exactly one live offer`);
    checkContract(lab, snap, new Set([...single, ...whole].map((r) => r.requestId)));
    checkPlanVersions(lab, snap);
  },
};

const correctionVersusAccept: Scenario = {
  name: "correction-vs-accept",
  about: "20 offers on one-person vans; at once: 2 accepts and 2 calls correcting the rider to a two-person lift",
  run: async (lab, world) => {
    const rows = await offered(lab, world, "cor", 20, crewOf(world, 1));
    const calls: AcceptCall[] = [];
    const ops = rows.flatMap(({ assignmentId, householdId }) => [
      ...Array.from({ length: 2 }, () => acceptOp(lab, assignmentId, calls)),
      ...Array.from({ length: 2 }, () => () => lab.mutate(api.households.update, { householdId, patch: { assistanceRequired: "two_person_lift" } })),
    ]);
    unexpectedErrors(lab, await storm(ops));
    const snap = await snapshot(lab);
    checkAcceptReturns(lab, snap, acceptWins(calls, rows.map((r) => r.assignmentId)));
    checkEndings(lab, snap, rows);
    for (const row of rows) lab.expect(snap.requests.get(row.requestId)?.crewNeeded === 2, `request ${row.requestId} now needs a crew of two`);
    checkContract(lab, snap, new Set(rows.map((r) => r.requestId)));
  },
};

const closeVersusAccept: Scenario = {
  name: "close-vs-accept",
  about: "20 open offers; at once: 2 accepts and 2 calls where the rider says they can leave on their own",
  run: async (lab, world) => {
    const rows = await offered(lab, world, "cls", 20);
    const calls: AcceptCall[] = [];
    const ops = rows.flatMap(({ assignmentId, householdId }) => [
      ...Array.from({ length: 2 }, () => acceptOp(lab, assignmentId, calls)),
      ...Array.from({ length: 2 }, () => () => lab.mutate(api.households.update, { householdId, patch: { canLeave: "yes" } })),
    ]);
    unexpectedErrors(lab, await storm(ops));
    const snap = await snapshot(lab);
    checkAcceptReturns(lab, snap, acceptWins(calls, rows.map((r) => r.assignmentId)));
    for (const row of rows) {
      lab.expect(snap.requests.get(row.requestId)?.status === "closed", `request ${row.requestId} is closed`);
      lab.expect(callbacksFor(snap, row.assignmentId, "reassigning").length === 0, `rider ${row.requestId} who is leaving on their own gets no reassigning call`);
    }
    checkContract(lab, snap, new Set(rows.map((r) => r.requestId)));
  },
};

type Commit = typeof commit._args;

function staleCommit(rows: Row[], vehicleId: Id<"vehicles">): Commit {
  return {
    offers: rows.map(({ requestId }, sequence) => ({ requestId, vehicleId, etaMinutes: 9, sequence })),
    replace: rows.map((r) => r.assignmentId),
    revoke: [],
    etaUpdates: [],
    escalate: [],
    closureEdges: [],
    closuresSeen: 0,
    solver: "heuristic",
    solveMs: 1,
    requestCount: rows.length,
    vehicleCount: 2,
  };
}

const staleDispatch: Scenario = {
  name: "stale-dispatch",
  about: "24 open offers; while 4 re-plans commit plans solved before any of this, 8 drivers accept and 6 riders leave on their own",
  run: async (lab, world) => {
    const [first, second] = crewOf(world, 2);
    const rows = await offered(lab, world, "stl", 24, [first]);
    const accepting = rows.slice(0, 8);
    const leaving = rows.slice(8, 14);
    const calls: AcceptCall[] = [];
    const ops = [
      ...accepting.map((row) => acceptOp(lab, row.assignmentId, calls)),
      ...leaving.map((row) => () => lab.mutate(api.households.update, { householdId: row.householdId, patch: { canLeave: "yes" } })),
      ...Array.from({ length: 4 }, () => () => lab.mutate(commit, staleCommit(rows, second._id))),
    ];
    unexpectedErrors(lab, await storm(ops));
    const snap = await snapshot(lab);
    const wins = acceptWins(calls, accepting.map((r) => r.assignmentId));
    for (const row of accepting.filter((r) => wins.get(r.assignmentId) === 1)) {
      const live = liveFor(snap, row.requestId);
      lab.expect(live.length === 1 && live[0]._id === row.assignmentId, `accepted pickup ${row.requestId} stayed with its driver`);
    }
    for (const row of leaving) lab.expect(liveFor(snap, row.requestId).length === 0, `request ${row.requestId} closed mid-solve got no new offer`);
    checkAcceptReturns(lab, snap, wins);
    checkContract(lab, snap, new Set(rows.map((r) => r.requestId)));
    checkPlanVersions(lab, snap);
  },
};

const staleProposal: Scenario = {
  name: "stale-propose",
  about: "an outside solver (plans:propose) offers a ride to requests that closed while it was solving",
  run: async (lab, world) => {
    const rows = await requests(lab, "stp", 5);
    await Promise.all(rows.map((row) => lab.must(api.households.update, { householdId: row.householdId, patch: { canLeave: "yes" } })));
    const results = await storm(rows.map(({ requestId }, i) => () =>
      lab.mutate(api.plans.propose, plan([{ requestId, vehicleId: pick(world.vehicles, i)._id, etaMinutes: 5, stopOrder: lab.stopOrder() }])),
    ));
    lab.expect(results.every((r) => !r.ok && !conflictTable(r.error)), `plans:propose refuses offers for closed requests (${results.filter((r) => r.ok).length} of ${rows.length} let through)`);
    const snap = await snapshot(lab);
    const accepts = await storm(snap.assignments.filter((a) => rows.some((r) => r.requestId === a.requestId) && a.status === "offered").map((a) => () => lab.mutate(api.offers.accept, { assignmentId: a._id })));
    lab.expect(accepts.every((r) => r.ok && r.value === "changed"), `a driver accepting such an offer hears "changed" (${JSON.stringify(accepts.map((r) => (r.ok ? r.value : r.error)))})`);
    checkContract(lab, await snapshot(lab), new Set(rows.map((r) => r.requestId)));
  },
};

// A night of re-plans churns offers: each one the solver changes ends `replaced` and a new one starts.
const requestChurn: Scenario = {
  name: "request-churn",
  about: "one request re-offered 60 times by successive plans, then a second offer, a correction and a close",
  run: async (lab, world) => {
    const [row] = await requests(lab, "chr", 1);
    const oneCrew = crewOf(world, 1);
    let live = await lab.offer(row.requestId, oneCrew[0]._id);
    for (let i = 1; i <= 60; i++) {
      await lab.must(api.plans.propose, plan([{ requestId: row.requestId, vehicleId: pick(oneCrew, i)._id, etaMinutes: 5, stopOrder: lab.stopOrder() }], [live]));
      const snap = await snapshot(lab);
      live = liveFor(snap, row.requestId)[0]._id;
    }
    const second = await lab.mutate(api.plans.propose, plan([{ requestId: row.requestId, vehicleId: world.vehicles[0]._id, etaMinutes: 5, stopOrder: lab.stopOrder() }]));
    lab.expect(refusedWith(second, /already has a live assignment/), `after 60 re-plans, a second live offer for the request is still refused (${describe(second)})`);
    await lab.must(api.households.update, { householdId: row.householdId, patch: { assistanceRequired: "two_person_lift" } });
    let snap = await snapshot(lab);
    lab.expect(liveFor(snap, row.requestId).every((a) => snap.vehicles.get(a.vehicleId)!.crewSize >= 2), "after 60 re-plans, a correction still drops the offer the vehicle can no longer serve");
    await lab.must(api.households.update, { householdId: row.householdId, patch: { canLeave: "yes" } });
    snap = await snapshot(lab);
    lab.expect(liveFor(snap, row.requestId).length === 0, "after 60 re-plans, closing the request still ends every live offer");
    checkContract(lab, snap, new Set([row.requestId]));
  },
};

const vehicleChurn: Scenario = {
  name: "vehicle-churn",
  about: "one van offered 110 pickups that later plans replaced, then one accepted stop and an offer that would cut in front of it",
  run: async (lab, world) => {
    const vehicle = crewOf(world, 2)[0];
    const rows = await requests(lab, "vch", 111);
    const churned = rows.slice(0, 110);
    await lab.must(api.plans.propose, plan(churned.map(({ requestId }) => ({ requestId, vehicleId: vehicle._id, etaMinutes: 5, stopOrder: lab.stopOrder() }))));
    const offers = (await snapshot(lab)).assignments.filter((a) => a.vehicleId === vehicle._id && a.status === "offered");
    await lab.must(api.plans.propose, plan([], offers.map((a) => a._id)));
    const acceptedId = await lab.accept(await lab.offer(rows[110].requestId, vehicle._id));
    const run = await lab.query(api.offers.forVehicle, { vehicleId: vehicle._id });
    lab.expect(run.some((a) => a._id === acceptedId), "after 110 replaced offers, the driver page still shows the accepted stop");
    // One stop ahead of the accepted one, and behind any stop earlier scenarios left on this van,
    // so only the new accepted stop can refuse it.
    const { stopOrder } = (await lab.table("assignments")).find((a) => a._id === acceptedId)!;
    const [late] = await requests(lab, "vcl", 1);
    const cutIn = await lab.mutate(api.plans.propose, plan([{ requestId: late.requestId, vehicleId: vehicle._id, etaMinutes: 5, stopOrder: stopOrder - 1 }]));
    lab.expect(refusedWith(cutIn, /accepted run can't take new stops/), `after 110 replaced offers, an offer ahead of the accepted stop is still refused (${describe(cutIn)})`);
  },
};

// A rider who keeps changing their mind on calls opens and closes a request each time.
const householdChurn: Scenario = {
  name: "household-churn",
  about: "one rider flips between 'I can leave' and 'I can't' 25 times, then answers twice more",
  run: async (lab) => {
    const [householdId] = await lab.riders("hch", 1);
    for (let i = 0; i < 25; i++) {
      await lab.must(api.households.update, { householdId, patch: { canLeave: "no" } });
      await lab.must(api.households.update, { householdId, patch: { canLeave: "yes" } });
    }
    await lab.must(api.households.update, { householdId, patch: { canLeave: "no" } });
    await lab.must(api.households.update, { householdId, patch: { peopleCount: 2 } });
    const open = (await lab.table("requests")).filter((r) => r.householdId === householdId && r.status !== "closed");
    lab.expect(open.length === 1, `the rider has exactly one open request (has ${open.length})`);
  },
};

const PATCHES: RecordPatch[] = [
  { canLeave: "no" },
  { canLeave: "yes" },
  { canLeave: "unsure" },
  { mobility: "manual_wheelchair" },
  { mobility: "walks" },
  { canLeave: "yes", hasCar: false },
];

// Household counts are applied by the aggregate's queue, so they trail the records briefly.
const COUNTS_SETTLE_MS = 10_000;

async function settledCounts(lab: Lab, rows: Doc<"households">[]) {
  const expected = countBy(rows, (h) => h.outcome);
  const started = Date.now();
  for (;;) {
    const counts = await lab.query(api.households.counts, {});
    const counted: Record<string, number> = counts.outcome;
    const settled = counts.total === rows.length && Object.entries(expected).every(([outcome, n]) => counted[outcome] === n);
    const waitedMs = Date.now() - started;
    if (settled || waitedMs > COUNTS_SETTLE_MS) return { counts, waitedMs };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const concurrentCorrections: Scenario = {
  name: "concurrent-corrections",
  about: "150 riders, 450 record updates sent all at once; household counts and requests must match the records",
  run: async (lab) => {
    const households = await lab.riders("ccr", 150);
    const ops = households.flatMap((householdId) => Array.from({ length: 3 }, () => () => lab.mutate(api.households.update, { householdId, patch: PATCHES[Math.floor(Math.random() * PATCHES.length)] })));
    unexpectedErrors(lab, await storm(ops), NONE);
    // Each update writes a different household. Only the shared household counts link them.
    const given = Object.entries(lab.conflicts[lab.scenario] ?? {});
    lab.expect(given.length === 0, `updates to different households never give up on a write conflict (${JSON.stringify(Object.fromEntries(given))} of ${ops.length})`);
    const [rows, requests] = await Promise.all([lab.table("households"), lab.table("requests")]);
    const { counts, waitedMs } = await settledCounts(lab, rows);
    lab.expect(counts.total === rows.length, `household count ${counts.total} matches ${rows.length} rows (after ${waitedMs} ms)`);
    const counted: Record<string, number> = counts.outcome;
    for (const [outcome, n] of Object.entries(countBy(rows, (h) => h.outcome))) {
      lab.expect((counted[outcome] ?? 0) === n, `${outcome} count ${counted[outcome] ?? 0} matches ${n} rows`);
    }
    lab.expect(waitedMs <= COUNTS_SETTLE_MS, `household counts catch up with the records within ${COUNTS_SETTLE_MS / 1000}s (took ${waitedMs} ms)`);
    const mine = new Set(households);
    for (const household of rows.filter((h) => mine.has(h._id))) {
      const open = requests.filter((r) => r.householdId === household._id && r.status !== "closed").length;
      const needsRide = household.outcome === "needs_ride" || household.outcome === "needs_accessible";
      lab.expect(open === (needsRide ? 1 : 0), `household ${household._id} (${household.outcome}) has ${needsRide ? "one" : "no"} open request (has ${open})`);
    }
  },
};

// The call floor's pace: 12 live calls (control.maxConcurrentCalls), each writing its own household
// one answer at a time, as the voice agent's update_household tool does.
const callFloorLoad: Scenario = {
  name: "call-floor-load",
  about: "12 calls at once, each saving 30 answers in a row to its own household",
  run: async (lab) => {
    const households = await lab.riders("cfl", 12);
    const started = Date.now();
    const results = await Promise.all(
      households.map(async (householdId) => {
        const mine: Outcome<unknown>[] = [];
        for (let i = 0; i < 30; i++) mine.push(await lab.mutate(api.households.update, { householdId, patch: PATCHES[i % PATCHES.length] }));
        return mine;
      }),
    );
    const flat = results.flat();
    unexpectedErrors(lab, flat, NONE);
    const lost = flat.filter((r) => !r.ok).length;
    const perSecond = Math.round(flat.length / ((Date.now() - started) / 1000));
    lab.expect(lost === 0, `no answer is lost to a write conflict at call-floor pace (${lost} of ${flat.length} lost, ${perSecond} writes/s)`);
  },
};

const inboundSameNumber: Scenario = {
  name: "inbound-same-number",
  about: "10 unknown numbers, each calling in 25 times at once",
  run: async (lab) => {
    const numbers = Array.from({ length: 10 }, (_, i) => `+1999555${String(100 + i).padStart(4, "0")}`);
    const results = await storm(numbers.flatMap((callbackNumber) => Array.from({ length: 25 }, () => () => lab.mutate(api.households.findOrCreateByPhone, { callbackNumber }))));
    unexpectedErrors(lab, results, NONE);
    const rows = await lab.table("households");
    for (const number of numbers) {
      const n = rows.filter((h) => h.callbackNumber === number).length;
      lab.expect(n === 1, `${number} has exactly one household (has ${n})`);
    }
  },
};

// The voice server's writes are fire-and-forget, so they can land out of order.
const callbackOrdering: Scenario = {
  name: "callback-ordering",
  about: "10 callbacks marked played, then a late 'placed' and a late 'unanswered' from the same call",
  run: async (lab, world) => {
    const rows = await offered(lab, world, "cbo", 10);
    await Promise.all(rows.map((row) => lab.accept(row.assignmentId)));
    const mine = new Set(rows.map((r) => r.requestId));
    const callbacks = (await lab.table("callbacks")).filter((c) => mine.has(c.requestId));
    for (const { _id: callbackId } of callbacks) await lab.must(api.callbacks.markPlayed, { callbackId });
    await storm(callbacks.flatMap(({ _id: callbackId }) => [() => lab.mutate(api.callbacks.markPlaced, { callbackId }), () => lab.mutate(api.callbacks.markUnanswered, { callbackId })]));
    const after = (await lab.table("callbacks")).filter((c) => mine.has(c.requestId));
    const regressed = after.filter((c) => c.state !== "played");
    lab.expect(regressed.length === 0, `a callback already played stays played (${regressed.length} of ${after.length} moved to ${JSON.stringify(countBy(regressed, (c) => c.state))})`);
  },
};

type ChaosView = { lab: Lab; world: World; households: Id<"households">[]; requestIds: Id<"requests">[]; open: Doc<"assignments">[]; accepted: Doc<"assignments">[]; calls: AcceptCall[] };

const any = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];

// Each operation acts on what its client last saw, which is often stale by the time it lands.
const CHAOS_OPS: ((view: ChaosView) => (() => Promise<Outcome<unknown>>) | null)[] = [
  ({ lab, world, requestIds, open }) => requestIds.length === 0 ? null : () =>
    lab.mutate(commit, { ...staleCommit([], any(world.vehicles)._id), offers: [{ requestId: any(requestIds), vehicleId: any(world.vehicles)._id, etaMinutes: 7, sequence: 0 }], replace: open.length > 0 && Math.random() < 0.5 ? [any(open)._id] : [] }),
  ({ lab, open, calls }) => (open.length > 0 ? acceptOp(lab, any(open)._id, calls) : null),
  ({ lab, accepted, calls }) => (accepted.length > 0 ? acceptOp(lab, any(accepted)._id, calls) : null),
  ({ lab, open }) => (open.length > 0 ? () => lab.mutate(api.offers.decline, { assignmentId: any(open)._id }) : null),
  ({ lab, open }) => (open.length > 0 ? () => lab.mutate(expire, { assignmentId: any(open)._id }) : null),
  ({ lab, accepted }) => (accepted.length > 0 ? () => lab.mutate(api.offers.cancelByDriver, { assignmentId: any(accepted)._id }) : null),
  ({ lab, households }) => () => lab.mutate(api.households.update, { householdId: any(households), patch: { assistanceRequired: any(["none", "one_person_assist", "two_person_lift"] as const) } }),
  ({ lab, households }) => () => lab.mutate(api.households.update, { householdId: any(households), patch: { mobility: any(["walks", "walker", "manual_wheelchair"] as const) } }),
  ({ lab, households }) => () => lab.mutate(api.households.update, { householdId: any(households), patch: { canLeave: any(["yes", "no", "no", "unsure"] as const) } }),
];

async function chaosView(lab: Lab, world: World, households: Id<"households">[], calls: AcceptCall[]): Promise<ChaosView> {
  const mine = new Set(households);
  const [requestRows, assignments] = await Promise.all([lab.table("requests"), lab.table("assignments")]);
  const requestIds = requestRows.filter((r) => mine.has(r.householdId) && r.status !== "closed").map((r) => r._id);
  const ours = assignments.filter((a) => mine.has(a.householdId));
  const open = ours.filter((a) => a.status === "offered" || a.status === "proposed");
  return { lab, world, households, requestIds, open, accepted: ours.filter((a) => a.status === "accepted"), calls };
}

const chaos: Scenario = {
  name: "chaos",
  about: "40 riders, 8 rounds of 120 random writes at once from stale views: dispatcher commits, accepts, declines, expiries, cancels, corrections, riders leaving and coming back",
  run: async (lab, world) => {
    const rows = await requests(lab, "chs", 40);
    const households = rows.map((r) => r.householdId);
    const calls: AcceptCall[] = [];
    const results: Outcome<unknown>[] = [];
    for (let round = 0; round < 8; round++) {
      const view = await chaosView(lab, world, households, calls);
      const ops = Array.from({ length: 120 }, () => any(CHAOS_OPS)(view)).filter((op) => op !== null);
      results.push(...(await storm(ops)));
    }
    unexpectedErrors(lab, results);
    const snap = await snapshot(lab);
    const mine = new Set(households);
    checkAcceptReturns(lab, snap, acceptWins(calls, [...new Set(calls.map((c) => c.assignmentId))]));
    checkContract(lab, snap, new Set([...snap.requests.values()].filter((r) => mine.has(r.householdId)).map((r) => r._id)));
    checkPlanVersions(lab, snap);
    const told = snap.callbacks.filter((c) => mine.has(c.householdId)).length;
    lab.expect(told > 0, `the storm reached riders at all (${told} callbacks, ${snap.assignments.filter((a) => mine.has(a.householdId)).length} assignments)`);
  },
};

export const SCENARIOS: Scenario[] = [
  doubleAccept,
  acceptVersusEnd,
  cancelStorm,
  proposeRace,
  correctionVersusAccept,
  closeVersusAccept,
  staleDispatch,
  staleProposal,
  requestChurn,
  vehicleChurn,
  householdChurn,
  concurrentCorrections,
  callFloorLoad,
  inboundSameNumber,
  callbackOrdering,
  chaos,
];
