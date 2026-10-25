import { Doc, Id } from "./_generated/dataModel";
import type { Snapshot } from "./dispatchSnapshot";
import { isSolution, PlannedStop, Problem, ProblemRequest, Solution } from "./dispatchProblem";
import { solveHeuristic } from "./heuristic";
import { OFFER_TTL_MS, vehicleCanServe } from "./model";
import { closedEdgeSet, closedEdgesFor, edgeKeysOf, nearestNode, nodePoint, shortestPathsFrom, ShortestPaths, streetNames } from "./roadGraph";
import { forecastRun, RunState, SIMULATED_TIME_LAPSE } from "./vehicleRun";

// The pure half of re-planning: snapshot in, problem out; solution in, commit arguments out.

// Guided local search runs until its time limit, so small problems get less: 0.5 s plus 50 ms per rider, at most 3 s.
const solverTimeLimit = (riders: number) => Math.min(3, 0.5 + 0.05 * riders);
const SOLVER_TIMEOUT_MS = 8_000;
// Riders on oxygen ride at most this long between pickup and shelter.
const OXYGEN_MAX_RIDE_SECONDS = 45 * 60;
// An accepted pickup is revoked only when a change makes the van miss the deadline by this much
// more than the ETA the rider was given. Being a little later than forecast isn't a reason.
const REVOKE_TOLERANCE_MS = 10 * 60_000;
const ETA_REFRESH_MS = 60_000;

class TravelTable {
  private rows = new Map<number, ShortestPaths>();

  constructor(private closed: ReadonlySet<number>) {}

  seconds = (from: number, to: number) => {
    let row = this.rows.get(from);
    if (!row) {
      row = shortestPathsFrom(from, this.closed);
      this.rows.set(from, row);
    }
    const seconds = row.seconds[to];
    return Number.isFinite(seconds) ? seconds : null;
  };
}

type RequestEntry = Snapshot["requests"][number];
type Located = RequestEntry & { lat: number; lng: number; node: number };

function snapClosures(closures: Snapshot["closures"]) {
  const updates: { closureId: Id<"roadClosures">; edgeKeys: string[]; streets: string[] }[] = [];
  const snapped = closures.map((closure) => {
    if (closure.edgeKeys) return closure;
    const edges = closedEdgesFor(closure);
    const edgeKeys = edgeKeysOf(edges);
    updates.push({ closureId: closure._id, edgeKeys, streets: streetNames(edges) });
    return { ...closure, edgeKeys };
  });
  // A resident's mention stays unconfirmed until someone checks it, so the plan doesn't route around it yet.
  return { updates, closed: closedEdgeSet(snapped.filter((closure) => closure.confirmed)) };
}

function locate(entry: RequestEntry): Located | null {
  if (entry.lat === undefined || entry.lng === undefined) return null;
  return { ...entry, lat: entry.lat, lng: entry.lng, node: nearestNode({ lat: entry.lat, lng: entry.lng }) };
}

type Context = {
  snap: Snapshot;
  now: number;
  travel: TravelTable;
  requests: Map<Id<"requests">, Located>;
  shelterNodes: { shelter: Doc<"shelters">; node: number }[];
};

function shelterFor(context: Context) {
  return (from: number) => {
    let best: { node: number; seconds: number } | null = null;
    for (const { node } of context.shelterNodes) {
      const seconds = context.travel.seconds(from, node);
      if (seconds !== null && (best === null || seconds < best.seconds)) best = { node, seconds };
    }
    return best;
  };
}

function dwellSeconds(context: Context, vehicleId: Id<"vehicles">) {
  const route = context.snap.routes.find((r) => r.vehicleId === vehicleId);
  if (!route?.dwellUntil) return 0;
  return Math.max(0, ((route.dwellUntil - context.now) / 1000) * SIMULATED_TIME_LAPSE);
}

function acceptedRun(context: Context, vehicle: Doc<"vehicles">, skip: Set<Id<"assignments">>) {
  const accepted = context.snap.live
    .filter((a) => a.vehicleId === vehicle._id && a.status === "accepted" && !skip.has(a._id))
    .sort((a, b) => a.stopOrder - b.stopOrder);
  const pickups = [];
  for (const assignment of accepted) {
    const entry = context.requests.get(assignment.requestId);
    if (!entry) continue;
    pickups.push({ id: assignment._id, node: entry.node, load: entry.request.load, boardingSeconds: entry.request.boardingMinutes * 60 });
  }
  const state: RunState<Id<"assignments">> = {
    node: nearestNode(vehicle),
    onboard: context.snap.onboard.filter((rider) => rider.vehicleId === vehicle._id).map((rider) => rider.load),
    pickups,
    capacity: vehicle,
  };
  return { accepted, forecast: forecastRun(state, dwellSeconds(context, vehicle._id), context.travel.seconds, shelterFor(context)) };
}

function revocationReason(context: Context, assignment: Doc<"assignments">, arrival: number | null | undefined) {
  if (arrival === undefined) return null;
  if (arrival === null) return "no open road reaches them";
  const request = context.requests.get(assignment.requestId)?.request;
  if (!request) return null;
  const arrivalAt = context.now + arrival * 1000;
  const promisedAt = (assignment.etaUpdatedAt ?? assignment.respondedAt ?? assignment.proposedAt) + assignment.etaMinutes * 60_000;
  const late = arrivalAt > request.deadlineAt && arrivalAt - promisedAt > REVOKE_TOLERANCE_MS;
  return late ? "the only open route arrives after their deadline" : null;
}

function etaUpdate(context: Context, assignment: Doc<"assignments">, arrival: number | null | undefined) {
  if (arrival === undefined || arrival === null) return null;
  const etaMinutes = Math.max(1, Math.ceil(arrival / 60));
  const fresh = context.now - (assignment.etaUpdatedAt ?? 0) < ETA_REFRESH_MS;
  return etaMinutes === assignment.etaMinutes && fresh ? null : { assignmentId: assignment._id, etaMinutes };
}

type VehiclePlan = {
  vehicle: Doc<"vehicles">;
  endNode: number;
  endSeconds: number;
  revoke: { assignmentId: Id<"assignments">; reason: string }[];
  etaUpdates: { assignmentId: Id<"assignments">; etaMinutes: number }[];
};

// Forecast the accepted run, revoke what a change made unreachable in time, then forecast again without it.
function planVehicle(context: Context, vehicle: Doc<"vehicles">): VehiclePlan {
  const first = acceptedRun(context, vehicle, new Set());
  const revoke = first.accepted.flatMap((assignment) => {
    const reason = revocationReason(context, assignment, first.forecast.arrivals.get(assignment._id));
    return reason ? [{ assignmentId: assignment._id, reason }] : [];
  });
  const final = revoke.length > 0 ? acceptedRun(context, vehicle, new Set(revoke.map((r) => r.assignmentId))) : first;
  const etaUpdates = final.accepted.flatMap((assignment) => {
    const update = etaUpdate(context, assignment, final.forecast.arrivals.get(assignment._id));
    return update ? [update] : [];
  });
  return { vehicle, endNode: final.forecast.endNode, endSeconds: final.forecast.endSeconds, revoke, etaUpdates };
}

type OpenOffer = { assignment: Doc<"assignments">; stale: boolean };

function openOffers(snap: Snapshot, now: number) {
  const offers = new Map<Id<"requests">, OpenOffer>();
  for (const assignment of snap.live) {
    if (assignment.status === "accepted") continue;
    const stale = assignment.status === "proposed" && now - assignment.proposedAt > OFFER_TTL_MS;
    offers.set(assignment.requestId, { assignment, stale });
  }
  return offers;
}

const WAITING = new Set<Doc<"requests">["status"]>(["received", "approved", "reassigning"]);

// Riders who need a vehicle this round: waiting ones, plus accepted pickups being revoked right now,
// so the same plan that revokes a pickup also finds the rider a new driver.
function ridersToPlan(context: Context, revoking: Set<Id<"requests">>) {
  const acceptedRequests = new Set(context.snap.live.filter((a) => a.status === "accepted").map((a) => a.requestId));
  return [...context.requests.values()].filter(
    (entry) => revoking.has(entry.request._id) || (WAITING.has(entry.request.status) && !acceptedRequests.has(entry.request._id)),
  );
}

function refusedPairs(snap: Snapshot, revoke: { assignmentId: Id<"assignments"> }[]) {
  const pairs = new Set(snap.refused.map((a) => `${a.requestId}:${a.vehicleId}`));
  for (const { assignmentId } of revoke) {
    const assignment = snap.live.find((a) => a._id === assignmentId);
    if (assignment) pairs.add(`${assignment.requestId}:${assignment.vehicleId}`);
  }
  return pairs;
}

class Locations {
  nodes: number[] = [];
  private index = new Map<number, number>();

  of(node: number) {
    let i = this.index.get(node);
    if (i === undefined) {
      i = this.nodes.length;
      this.nodes.push(node);
      this.index.set(node, i);
    }
    return i;
  }
}

function problemRequest(context: Context, entry: Located, locations: Locations, allowed: number[], openVehicle: number | null): ProblemRequest {
  const { request } = entry;
  return {
    id: request._id,
    location: locations.of(entry.node),
    load: request.load,
    boardingSeconds: request.boardingMinutes * 60,
    deadline: (request.deadlineAt - context.now) / 1000,
    weight: request.weight,
    allowedVehicles: allowed,
    openOfferVehicle: openVehicle,
    maxRideSeconds: entry.oxygen ? OXYGEN_MAX_RIDE_SECONDS : null,
  };
}

const party = (load: { seats: number; wheelchairSpaces: number; stretcherSpaces: number }) =>
  load.seats + load.wheelchairSpaces + load.stretcherSpaces;

// People on board or with an accepted pickup headed to this shelter.
function promisedTo(context: Context, shelterId: Id<"shelters">) {
  const onboard = context.snap.onboard.filter((rider) => rider.shelterId === shelterId);
  const accepted = context.snap.live.filter((a) => a.status === "accepted" && a.shelterId === shelterId);
  const acceptedPeople = accepted.reduce((sum, a) => sum + party(context.requests.get(a.requestId)?.request.load ?? { seats: 0, wheelchairSpaces: 0, stretcherSpaces: 0 }), 0);
  return onboard.reduce((sum, rider) => sum + party(rider.load), 0) + acceptedPeople;
}

export type World = ReturnType<typeof buildWorld>;

export function buildWorld(snap: Snapshot, now: number) {
  const { updates, closed } = snapClosures(snap.closures);
  const requests = new Map<Id<"requests">, Located>();
  for (const entry of snap.requests) {
    const located = locate(entry);
    if (located) requests.set(entry.request._id, located);
  }
  const shelterNodes = snap.shelters.map((shelter) => ({ shelter, node: nearestNode(shelter) }));
  const context: Context = { snap, now, travel: new TravelTable(closed), requests, shelterNodes };
  const vehicles = snap.vehicles.filter((vehicle) => vehicle.shiftEndsAt > now);
  const vehiclePlans = vehicles.map((vehicle) => planVehicle(context, vehicle));
  const revoke = vehiclePlans.flatMap((plan) => plan.revoke);
  const revokingRequests = new Set(revoke.map((r) => snap.live.find((a) => a._id === r.assignmentId)!.requestId));
  const refused = refusedPairs(snap, revoke);
  const offers = openOffers(snap, now);
  const riders = ridersToPlan(context, revokingRequests);

  const locations = new Locations();
  const problemVehicles = vehiclePlans.map((plan) => ({
    id: plan.vehicle._id,
    location: locations.of(plan.endNode),
    availableAt: plan.endSeconds,
    endBy: (plan.vehicle.shiftEndsAt - now) / 1000,
    seats: plan.vehicle.seats,
    wheelchairSpaces: plan.vehicle.wheelchairSpaces,
    stretcherSpaces: plan.vehicle.stretcherSpaces,
  }));
  const problemRequests = riders.map((entry) => {
    const allowed = vehicles.flatMap((vehicle, k) =>
      vehicleCanServe(vehicle, entry.request) && !refused.has(`${entry.request._id}:${vehicle._id}`) ? [k] : [],
    );
    const open = offers.get(entry.request._id);
    const openVehicle = open && !open.stale ? vehicles.findIndex((vehicle) => vehicle._id === open.assignment.vehicleId) : -1;
    return problemRequest(context, entry, locations, allowed, openVehicle >= 0 ? openVehicle : null);
  });
  const shelters = shelterNodes.map(({ shelter, node }) => ({
    id: shelter._id,
    location: locations.of(node),
    // Room left: the solver and heuristic must not promise a shelter more people than it can still take.
    capacity: Math.max(0, shelter.capacity - (shelter.occupied ?? 0) - promisedTo(context, shelter._id)),
  }));
  const matrix = locations.nodes.map((from) => locations.nodes.map((to) => context.travel.seconds(from, to)));

  const problem: Problem = {
    policy: "alns",
    locations: locations.nodes.map(nodePoint),
    matrix,
    vehicles: problemVehicles,
    requests: problemRequests,
    shelters,
    timeLimitSeconds: solverTimeLimit(problemRequests.length),
  };
  return {
    now,
    problem,
    vehicles,
    riders: new Map(riders.map((entry) => [entry.request._id as string, entry])),
    offers,
    revoke,
    etaUpdates: vehiclePlans.flatMap((plan) => plan.etaUpdates),
    closureEdges: updates,
    closuresSeen: snap.closures.length,
  };
}

function failureReason(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "solver service timed out";
  if (error instanceof Error && error.message.startsWith("solver service")) return error.message;
  return "solver service unreachable";
}

function solverHeaders(): Record<string, string> {
  const token = process.env.SOLVER_TOKEN;
  return token ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` } : { "Content-Type": "application/json" };
}

// A service built before ALNS ignores the policy and answers with OR-Tools; the plan records which one ran.
const SERVICE_SOLVERS = ["alns", "ortools", "heuristic"] as const;

async function askSolverService(url: string, problem: Problem): Promise<Solution> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOLVER_TIMEOUT_MS);
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/solve`, {
      method: "POST",
      headers: solverHeaders(),
      body: JSON.stringify(problem),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`solver service returned ${response.status}`);
    const body: unknown = await response.json();
    if (!isSolution(body)) throw new Error("solver service sent an unreadable plan");
    return { ...body, solver: SERVICE_SOLVERS.find((name) => name === body.solver) ?? "ortools" };
  } finally {
    clearTimeout(timer);
  }
}

// The solver service (ALNS) when it answers in time, otherwise the heuristic. The plan records why.
export async function solve(problem: Problem): Promise<{ solution: Solution; fallbackReason?: string }> {
  const url = process.env.SOLVER_URL;
  if (problem.requests.length === 0) {
    return { solution: { routes: [], dropped: [], solver: url ? "alns" : "heuristic", solveMs: 0 } };
  }
  if (!url) return { solution: solveHeuristic(problem), fallbackReason: "no solver service configured" };
  try {
    return { solution: await askSolverService(url, problem) };
  } catch (error) {
    return { solution: solveHeuristic(problem), fallbackReason: failureReason(error) };
  }
}

type Changes = {
  offers: { requestId: Id<"requests">; vehicleId: Id<"vehicles">; shelterId?: Id<"shelters">; etaMinutes: number; sequence: number }[];
  replace: Id<"assignments">[];
  escalate: Id<"households">[];
};

function planPickup(world: World, changes: Changes, vehicleId: Id<"vehicles">, stop: PlannedStop, sequence: number, shelter?: string) {
  const entry = world.riders.get(stop.request);
  if (!entry) return;
  const requestId = entry.request._id;
  const open = world.offers.get(requestId);
  const kept = open && !open.stale && open.assignment.vehicleId === vehicleId;
  if (!kept) {
    if (open) changes.replace.push(open.assignment._id);
    const etaMinutes = Math.max(1, Math.ceil(stop.arrival / 60));
    changes.offers.push({ requestId, vehicleId, shelterId: shelter as Id<"shelters"> | undefined, etaMinutes, sequence });
  }
  const late = world.now + stop.arrival * 1000 > entry.request.deadlineAt;
  if (late && !entry.escalated) changes.escalate.push(entry.request.householdId);
}

function planDropped(world: World, changes: Changes, requestId: string) {
  const entry = world.riders.get(requestId);
  if (!entry) return;
  const open = world.offers.get(entry.request._id);
  if (open) changes.replace.push(open.assignment._id);
  if (!entry.escalated) changes.escalate.push(entry.request.householdId);
}

export function planFromSolution(world: World, solution: Solution, fallbackReason?: string) {
  const changes: Changes = { offers: [], replace: [], escalate: [] };
  const planned = new Set<string>();
  for (const route of solution.routes) {
    const vehicle = world.vehicles.find((candidate) => candidate._id === route.vehicle);
    if (!vehicle) continue;
    const shelters = new Map(route.stops.filter((s) => s.kind === "dropoff").map((s) => [s.request, s.shelter ?? undefined]));
    const pickups = route.stops.filter((s) => s.kind === "pickup");
    for (const [sequence, stop] of pickups.entries()) {
      planned.add(stop.request);
      planPickup(world, changes, vehicle._id, stop, sequence, shelters.get(stop.request));
    }
  }
  for (const requestId of world.riders.keys()) {
    if (!planned.has(requestId)) planDropped(world, changes, requestId);
  }
  return {
    ...changes,
    revoke: world.revoke,
    etaUpdates: world.etaUpdates,
    closureEdges: world.closureEdges,
    closuresSeen: world.closuresSeen,
    solver: solution.solver,
    solveMs: solution.solveMs,
    requestCount: world.problem.requests.length,
    vehicleCount: world.problem.vehicles.length,
    fallbackReason,
  };
}
