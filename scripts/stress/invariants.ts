// The contract's promises, checked from the raw tables after a storm of conflicting writes
// (PLAN.md, "Request status and what the agent may say" and "Rules the contract already enforces").

import type { Doc, Id } from "../../convex/_generated/dataModel";
import { vehicleCanServe } from "../../convex/model";
import { Lab } from "./lab";

export type Snapshot = {
  requests: Map<Id<"requests">, Doc<"requests">>;
  assignments: Doc<"assignments">[];
  callbacks: Doc<"callbacks">[];
  vehicles: Map<Id<"vehicles">, Doc<"vehicles">>;
  plans: Doc<"plans">[];
};

export async function snapshot(lab: Lab): Promise<Snapshot> {
  const [requests, assignments, callbacks, vehicles, plans] = await Promise.all([
    lab.table("requests"),
    lab.table("assignments"),
    lab.table("callbacks"),
    lab.table("vehicles"),
    lab.table("plans"),
  ]);
  return {
    requests: new Map(requests.map((r) => [r._id, r])),
    assignments,
    callbacks,
    vehicles: new Map(vehicles.map((v) => [v._id, v])),
    plans,
  };
}

const LIVE = new Set(["proposed", "offered", "accepted"]);
// `revoked` is reachable only from `accepted`, and `completed` only after it.
const EVER_ACCEPTED = new Set(["accepted", "revoked", "completed"]);
const RIDING = new Set(["driver_accepted", "en_route", "arrived"]);

export const isLive = (a: Doc<"assignments">) => LIVE.has(a.status);
export const everAccepted = (a: Doc<"assignments">) => EVER_ACCEPTED.has(a.status);

export function liveFor(snap: Snapshot, requestId: Id<"requests">) {
  return snap.assignments.filter((a) => a.requestId === requestId && isLive(a));
}

export function callbacksFor(snap: Snapshot, assignmentId: Id<"assignments">, announces: Doc<"callbacks">["announces"]) {
  return snap.callbacks.filter((c) => c.assignmentId === assignmentId && c.announces === announces);
}

function checkRequest(lab: Lab, snap: Snapshot, request: Doc<"requests">) {
  const live = liveFor(snap, request._id);
  const accepted = live.filter((a) => a.status === "accepted");
  lab.expect(live.length <= 1, `request ${request._id} has at most one live assignment (has ${live.length})`);
  if (request.status === "closed") lab.expect(live.length === 0, `closed request ${request._id} has no live assignment`);
  if (RIDING.has(request.status) && request.status !== "arrived") {
    lab.expect(accepted.length === 1, `request ${request._id} in ${request.status} has exactly one accepted driver (has ${accepted.length})`);
  }
  if (accepted.length > 0) {
    lab.expect(RIDING.has(request.status), `request ${request._id} with an accepted driver is ${request.status}, not a riding status`);
  }
  if (request.status === "received" || request.status === "approved") {
    lab.expect(accepted.length === 0, `request ${request._id} in ${request.status} has no accepted driver`);
  }
  for (const assignment of live) {
    const vehicle = snap.vehicles.get(assignment.vehicleId);
    lab.expect(Boolean(vehicle && vehicleCanServe(vehicle, request)), `live assignment ${assignment._id} is on a vehicle that can serve request ${request._id}`);
  }
}

// The rider hears about a driver only once that driver accepted, exactly once, and hears about a
// revocation only if it happened, exactly once.
function checkCallbacks(lab: Lab, snap: Snapshot, assignment: Doc<"assignments">) {
  const told = callbacksFor(snap, assignment._id, "driver_accepted").length;
  const reassigning = callbacksFor(snap, assignment._id, "reassigning").length;
  lab.expect(told === (everAccepted(assignment) ? 1 : 0), `assignment ${assignment._id} (${assignment.status}) has ${everAccepted(assignment) ? "one" : "no"} driver_accepted callback (has ${told})`);
  lab.expect(reassigning <= 1, `assignment ${assignment._id} has at most one reassigning callback (has ${reassigning})`);
  if (reassigning > 0) lab.expect(assignment.status === "revoked", `assignment ${assignment._id} with a reassigning callback is revoked (is ${assignment.status})`);
}

export function checkContract(lab: Lab, snap: Snapshot, requestIds?: Set<Id<"requests">>) {
  const inScope = (id: Id<"requests">) => !requestIds || requestIds.has(id);
  for (const request of snap.requests.values()) if (inScope(request._id)) checkRequest(lab, snap, request);
  for (const assignment of snap.assignments) if (inScope(assignment.requestId)) checkCallbacks(lab, snap, assignment);
  const keys = new Set<string>();
  for (const callback of snap.callbacks) {
    lab.expect(!keys.has(callback.key), `callback key ${callback.key} is unique`);
    keys.add(callback.key);
  }
}

// Plan versions are handed out one at a time, so they run 1, 2, 3, … with no repeats or gaps.
export function checkPlanVersions(lab: Lab, snap: Snapshot) {
  const versions = snap.plans.map((p) => p.version).sort((a, b) => a - b);
  const contiguous = versions.every((version, i) => version === i + 1);
  lab.expect(contiguous, `plan versions run 1..${versions.length} with no repeats or gaps`);
}

// Each "accepted" an accept call returned must match one assignment that really was accepted.
export function checkAcceptReturns(lab: Lab, snap: Snapshot, wins: Map<Id<"assignments">, number>) {
  const byId = new Map(snap.assignments.map((a) => [a._id, a]));
  for (const [assignmentId, count] of wins) {
    const assignment = byId.get(assignmentId);
    lab.expect(count <= 1, `assignment ${assignmentId} was accepted by at most one call (by ${count})`);
    if (count > 0) lab.expect(Boolean(assignment && everAccepted(assignment)), `assignment ${assignmentId} that a call accepted shows as accepted (is ${assignment?.status})`);
    if (count === 0 && assignment) lab.expect(!everAccepted(assignment), `assignment ${assignmentId} no call accepted is not accepted (is ${assignment.status})`);
  }
}
