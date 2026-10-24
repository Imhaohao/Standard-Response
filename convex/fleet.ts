import { v } from "convex/values";
import { internalMutation, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { metersBetween, Point } from "./model";
import { completeAssignment } from "./offers";
import { maybeReplan } from "./dispatch";
import { standInDrivers } from "./dispatchStandIn";
import { transitionRequest } from "./requests";
import { closedEdgeSet, edgePath, legsFor, nearestNode, shortestPathsFrom } from "./roadGraph";
import { nextStop, positionAt, RunState, SIMULATED_TIME_LAPSE } from "./vehicleRun";

// Simulated vehicles drive their accepted runs along real road paths. Replaces the straight-line
// movement in dispatchStandIn.ts when the dispatch stand-in is switched off.

// Getting from where the van stands to the nearest intersection, or from the curb to the door.
const CURB_SPEED_MPS = 8;
// Vehicle rows are written this often, not every tick: re-plan commits read vehicles, and a write on
// every 0.9 s tick made busy commits conflict on every retry. dispatch:routes has the per-tick position.
const VEHICLE_POSITION_EVERY_MS = 2_500;

type Target = Doc<"vehicleRoutes">["target"];
// Where the run says to go next. A shelter wish names the riders' assigned shelter when the plan
// gave one; otherwise the nearest reachable shelter is used.
type Wish = { kind: "pickup"; assignmentId: Id<"assignments"> } | { kind: "shelter"; shelterId?: Id<"shelters"> };

type Fleet = {
  now: number;
  tickSeconds: number;
  closed: ReadonlySet<number>;
  closuresSeen: number;
  shelters: Doc<"shelters">[];
};

async function runOf(ctx: MutationCtx, vehicleId: Id<"vehicles">) {
  const rows = await ctx.db.query("assignments").withIndex("by_vehicleId", (q) => q.eq("vehicleId", vehicleId)).take(200);
  const accepted = rows.filter((a) => a.status === "accepted").sort((a, b) => a.stopOrder - b.stopOrder);
  const onboard: Doc<"requests">[] = [];
  let assignedShelter: Id<"shelters"> | undefined;
  for (const assignment of rows.filter((a) => a.status === "completed")) {
    const request = await ctx.db.get("requests", assignment.requestId);
    if (request?.status !== "arrived") continue;
    onboard.push(request);
    assignedShelter ??= assignment.shelterId;
  }
  return { accepted, onboard, assignedShelter };
}

async function nextWish(ctx: MutationCtx, vehicle: Doc<"vehicles">): Promise<{ wish: Wish | null; onboard: Doc<"requests">[] }> {
  const { accepted, onboard, assignedShelter } = await runOf(ctx, vehicle._id);
  const pickups = [];
  for (const assignment of accepted) {
    const request = await ctx.db.get("requests", assignment.requestId);
    if (request) pickups.push({ id: assignment._id, node: 0, load: request.load, boardingSeconds: request.boardingMinutes * 60 });
  }
  const state: RunState<Id<"assignments">> = { node: 0, onboard: onboard.map((r) => r.load), pickups, capacity: vehicle };
  const stop = nextStop(state);
  if (!stop) return { wish: null, onboard };
  const wish: Wish =
    stop.kind === "pickup" ? { kind: "pickup", assignmentId: stop.pickup.id } : { kind: "shelter", shelterId: assignedShelter };
  return { wish, onboard };
}

function routeServes(route: Doc<"vehicleRoutes">, wish: Wish) {
  if (wish.kind === "shelter") return route.target.kind === "shelter";
  return route.target.kind === "pickup" && route.target.assignmentId === wish.assignmentId;
}

async function destinationOf(ctx: MutationCtx, target: Target): Promise<Point | null> {
  if (target.kind === "shelter") return await ctx.db.get("shelters", target.shelterId);
  const assignment = await ctx.db.get("assignments", target.assignmentId);
  const household = assignment && (await ctx.db.get("households", assignment.householdId));
  if (!household || household.lat === undefined || household.lng === undefined) return null;
  return { lat: household.lat, lng: household.lng };
}

function curbSeconds(a: Point, b: Point) {
  return metersBetween(a, b) / CURB_SPEED_MPS;
}

// Road path from the van to the destination, avoiding closed roads. Null when no road gets there.
function roadPath(fromRow: Point, toRow: Point, closed: ReadonlySet<number>) {
  const from = { lat: fromRow.lat, lng: fromRow.lng };
  const to = { lat: toRow.lat, lng: toRow.lng };
  const start = nearestNode(from);
  const end = nearestNode(to);
  const paths = shortestPathsFrom(start, closed);
  const edges = edgePath(paths, end);
  if (!edges) return null;
  const { points, legSeconds } = legsFor(edges);
  const roadPoints = points.length > 0 ? points : [from];
  return {
    path: [from, ...roadPoints, to],
    legSeconds: [curbSeconds(from, roadPoints[0]), ...legSeconds, curbSeconds(roadPoints[roadPoints.length - 1], to)],
  };
}

function nearestShelter(fleet: Fleet, from: Point) {
  const start = nearestNode(from);
  const paths = shortestPathsFrom(start, fleet.closed);
  let best: Doc<"shelters"> | null = null;
  for (const shelter of fleet.shelters) {
    const seconds = paths.seconds[nearestNode(shelter)];
    if (Number.isFinite(seconds) && (!best || seconds < paths.seconds[nearestNode(best)])) best = shelter;
  }
  return best;
}

function resolveWish(fleet: Fleet, vehicle: Doc<"vehicles">, wish: Wish): Target | null {
  if (wish.kind === "pickup") return wish;
  if (wish.shelterId) return { kind: "shelter", shelterId: wish.shelterId };
  const shelter = nearestShelter(fleet, vehicle);
  return shelter ? { kind: "shelter", shelterId: shelter._id } : null;
}

async function freshRoute(ctx: MutationCtx, fleet: Fleet, vehicle: Doc<"vehicles">, target: Target, existing: Doc<"vehicleRoutes"> | null) {
  const destination = await destinationOf(ctx, target);
  const route = destination && roadPath(vehicle, destination, fleet.closed);
  const fields = {
    target,
    path: route?.path ?? [{ lat: vehicle.lat, lng: vehicle.lng }],
    legSeconds: route?.legSeconds ?? [],
    progressSeconds: 0,
    closuresSeen: fleet.closuresSeen,
    dwellUntil: undefined,
    updatedAt: fleet.now,
  };
  if (existing) {
    await ctx.db.replace("vehicleRoutes", existing._id, { vehicleId: vehicle._id, ...fields });
    return { ...existing, ...fields };
  }
  const id = await ctx.db.insert("vehicleRoutes", { vehicleId: vehicle._id, ...fields });
  return (await ctx.db.get("vehicleRoutes", id))!;
}

async function event(ctx: MutationCtx, message: string, householdId?: Id<"households">) {
  await ctx.db.insert("events", { kind: "dispatch", message, householdId, at: Date.now() });
}

async function arriveAtPickup(ctx: MutationCtx, fleet: Fleet, vehicle: Doc<"vehicles">, route: Doc<"vehicleRoutes">, assignmentId: Id<"assignments">) {
  const assignment = await ctx.db.get("assignments", assignmentId);
  if (assignment?.status !== "accepted") return;
  const request = await ctx.db.get("requests", assignment.requestId);
  await completeAssignment(ctx, assignmentId);
  const boardingMs = ((request?.boardingMinutes ?? 2) * 60_000) / SIMULATED_TIME_LAPSE;
  await ctx.db.patch("vehicleRoutes", route._id, { dwellUntil: fleet.now + boardingMs, updatedAt: fleet.now });
  const household = await ctx.db.get("households", assignment.householdId);
  await event(ctx, `${vehicle.label} reached ${household?.address ?? "the rider"}. Boarding`, assignment.householdId);
}

async function arriveAtShelter(ctx: MutationCtx, vehicle: Doc<"vehicles">, route: Doc<"vehicleRoutes">, onboard: Doc<"requests">[], shelterId: Id<"shelters">) {
  for (const request of onboard) await transitionRequest(ctx, request._id, "closed");
  await ctx.db.delete("vehicleRoutes", route._id);
  const shelter = await ctx.db.get("shelters", shelterId);
  const riders = onboard.length === 1 ? "1 rider" : `${onboard.length} riders`;
  await event(ctx, `${vehicle.label} dropped off ${riders} at ${shelter?.name ?? "the shelter"}`);
}

async function markEnRoute(ctx: MutationCtx, target: Target) {
  if (target.kind !== "pickup") return;
  const assignment = await ctx.db.get("assignments", target.assignmentId);
  const request = assignment && (await ctx.db.get("requests", assignment.requestId));
  if (request?.status === "driver_accepted") await transitionRequest(ctx, request._id, "en_route");
}

function needsNewPath(route: Doc<"vehicleRoutes"> | null, wish: Wish, fleet: Fleet) {
  if (!route || route.dwellUntil !== undefined) return true;
  return route.closuresSeen !== fleet.closuresSeen || !routeServes(route, wish);
}

async function drive(ctx: MutationCtx, fleet: Fleet, vehicle: Doc<"vehicles">, route: Doc<"vehicleRoutes">, onboard: Doc<"requests">[]) {
  if (route.legSeconds.length === 0) return;
  const total = route.legSeconds.reduce((sum, s) => sum + s, 0);
  const progressSeconds = Math.min(total, route.progressSeconds + fleet.tickSeconds * SIMULATED_TIME_LAPSE);
  const arriving = progressSeconds >= total;
  const positionDue = fleet.now - (route.positionWrittenAt ?? 0) >= VEHICLE_POSITION_EVERY_MS;
  if (arriving || positionDue) {
    const position = positionAt(route, progressSeconds);
    await ctx.db.patch("vehicles", vehicle._id, { lat: position.lat, lng: position.lng });
  }
  const positionWrittenAt = arriving || positionDue ? fleet.now : route.positionWrittenAt;
  await ctx.db.patch("vehicleRoutes", route._id, { progressSeconds, positionWrittenAt, updatedAt: fleet.now });
  await markEnRoute(ctx, route.target);
  if (progressSeconds < total) return;
  if (route.target.kind === "pickup") await arriveAtPickup(ctx, fleet, vehicle, route, route.target.assignmentId);
  else await arriveAtShelter(ctx, vehicle, route, onboard, route.target.shelterId);
}

async function moveVehicle(ctx: MutationCtx, fleet: Fleet, vehicle: Doc<"vehicles">) {
  const existing = await ctx.db.query("vehicleRoutes").withIndex("by_vehicleId", (q) => q.eq("vehicleId", vehicle._id)).unique();
  if (existing?.dwellUntil !== undefined && existing.dwellUntil > fleet.now) return;
  const { wish, onboard } = await nextWish(ctx, vehicle);
  if (!wish) {
    if (existing) await ctx.db.delete("vehicleRoutes", existing._id);
    return;
  }
  let route = existing;
  if (needsNewPath(existing, wish, fleet)) {
    const target = resolveWish(fleet, vehicle, wish);
    if (!target) return;
    route = await freshRoute(ctx, fleet, vehicle, target, existing);
  }
  if (route) await drive(ctx, fleet, vehicle, route, onboard);
}

export async function moveFleet(ctx: MutationCtx, now: number, tickMs: number) {
  const closures = await ctx.db.query("roadClosures").take(1000);
  const fleet: Fleet = {
    now,
    tickSeconds: tickMs / 1000,
    closed: closedEdgeSet(closures.filter((closure) => closure.confirmed)),
    closuresSeen: closures.filter((closure) => closure.edgeKeys !== undefined).length,
    shelters: await ctx.db.query("shelters").take(50),
  };
  for (const vehicle of await ctx.db.query("vehicles").take(200)) await moveVehicle(ctx, fleet, vehicle);
}

// Track C's real dispatcher and vehicle movement. The simulation tick schedules this once the
// "Dispatcher and vehicle movement" stand-in is off. It runs as its own transaction, so a failure
// here never stops the rest of the simulation.
export const tick = internalMutation({
  args: { tickMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { tickMs }) => {
    const control = await ctx.db.query("control").first();
    if (!control || control.simulateDispatch || !control.warningIssuedAt) return null;
    const now = Date.now();
    await maybeReplan(ctx, now);
    if (control.simulateDrivers) await standInDrivers(ctx, now);
    await moveFleet(ctx, now, tickMs);
    return null;
  },
});
