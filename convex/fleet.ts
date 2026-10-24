import { v } from "convex/values";
import { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { metersBetween, Point } from "./model";
import { completeAssignment } from "./offers";
import { maybeReplan } from "./dispatch";
import { standInDrivers } from "./dispatchStandIn";
import { transitionRequest } from "./requests";
import { closedEdgeSet, edgePath, legsFor, nearestNode, shortestPathsFrom } from "./roadGraph";
import { nextStop, positionAt, RunState, SIMULATED_TIME_LAPSE } from "./vehicleRun";
import { simNow } from "./clock";

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

type Rider = Doc<"vehicleLoads">["riders"][number];

// Riders already picked up. Read once from history the first time a vehicle is seen (say, after the
// stand-in dispatcher picked them up), then kept up to date at each pickup and drop-off.
async function loadOf(ctx: MutationCtx, vehicleId: Id<"vehicles">) {
  const row = await ctx.db.query("vehicleLoads").withIndex("by_vehicleId", (q) => q.eq("vehicleId", vehicleId)).unique();
  if (row) return row;
  const completed = await ctx.db
    .query("assignments")
    .withIndex("by_vehicleId_and_status_and_stopOrder", (q) => q.eq("vehicleId", vehicleId).eq("status", "completed"))
    .take(500);
  const riders: Rider[] = [];
  for (const assignment of completed) {
    const request = await ctx.db.get("requests", assignment.requestId);
    if (request?.status === "arrived") riders.push({ requestId: request._id, shelterId: assignment.shelterId, load: request.load });
  }
  const id = await ctx.db.insert("vehicleLoads", { vehicleId, riders });
  return (await ctx.db.get("vehicleLoads", id))!;
}

async function nextWish(ctx: MutationCtx, vehicle: Doc<"vehicles">) {
  const load = await loadOf(ctx, vehicle._id);
  // nextStop only looks at the first accepted pickup, so that's the only one read.
  const first = await ctx.db
    .query("assignments")
    .withIndex("by_vehicleId_and_status_and_stopOrder", (q) => q.eq("vehicleId", vehicle._id).eq("status", "accepted"))
    .first();
  const request = first && (await ctx.db.get("requests", first.requestId));
  const pickups = first && request ? [{ id: first._id, node: 0, load: request.load, boardingSeconds: request.boardingMinutes * 60 }] : [];
  const state: RunState<Id<"assignments">> = { node: 0, onboard: load.riders.map((r) => r.load), pickups, capacity: vehicle };
  const stop = nextStop(state);
  if (!stop) return { wish: null, load };
  const wish: Wish =
    stop.kind === "pickup" ? { kind: "pickup", assignmentId: stop.pickup.id } : { kind: "shelter", shelterId: load.riders[0]?.shelterId };
  return { wish, load };
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
  await ctx.db.insert("events", { kind: "dispatch", message, householdId, at: await simNow(ctx) });
}

type Visit = { fleet: Fleet; vehicle: Doc<"vehicles">; route: Doc<"vehicleRoutes">; load: Doc<"vehicleLoads"> };

async function arriveAtPickup(ctx: MutationCtx, { fleet, vehicle, route, load }: Visit, assignmentId: Id<"assignments">) {
  const assignment = await ctx.db.get("assignments", assignmentId);
  if (assignment?.status !== "accepted") return;
  const request = await ctx.db.get("requests", assignment.requestId);
  await completeAssignment(ctx, assignmentId);
  if (request) {
    const rider = { requestId: request._id, shelterId: assignment.shelterId, load: request.load };
    await ctx.db.patch("vehicleLoads", load._id, { riders: [...load.riders, rider] });
  }
  const boardingMs = ((request?.boardingMinutes ?? 2) * 60_000) / SIMULATED_TIME_LAPSE;
  await ctx.db.patch("vehicleRoutes", route._id, { dwellUntil: fleet.now + boardingMs, updatedAt: fleet.now });
  const household = await ctx.db.get("households", assignment.householdId);
  await event(ctx, `${vehicle.label} reached ${household?.address ?? "the rider"}. Boarding`, assignment.householdId);
}

const partySize = (rider: Rider) => rider.load.seats + rider.load.wheelchairSpaces + rider.load.stretcherSpaces;

async function arriveAtShelter(ctx: MutationCtx, { vehicle, route, load }: Visit, shelterId: Id<"shelters">) {
  for (const rider of load.riders) {
    const request = await ctx.db.get("requests", rider.requestId);
    if (request?.status === "arrived") await transitionRequest(ctx, request._id, "closed");
  }
  await ctx.db.patch("vehicleLoads", load._id, { riders: [] });
  await ctx.db.delete("vehicleRoutes", route._id);
  const shelter = await ctx.db.get("shelters", shelterId);
  if (shelter) {
    const people = load.riders.reduce((sum, rider) => sum + partySize(rider), 0);
    await ctx.db.patch("shelters", shelterId, { occupied: (shelter.occupied ?? 0) + people });
  }
  const riders = load.riders.length === 1 ? "1 rider" : `${load.riders.length} riders`;
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

async function drive(ctx: MutationCtx, visit: Visit) {
  const { fleet, vehicle, route } = visit;
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
  if (route.target.kind === "pickup") await arriveAtPickup(ctx, visit, route.target.assignmentId);
  else await arriveAtShelter(ctx, visit, route.target.shelterId);
}

async function moveVehicle(ctx: MutationCtx, fleet: Fleet, vehicle: Doc<"vehicles">) {
  const existing = await ctx.db.query("vehicleRoutes").withIndex("by_vehicleId", (q) => q.eq("vehicleId", vehicle._id)).unique();
  if (existing?.dwellUntil !== undefined && existing.dwellUntil > fleet.now) return;
  const { wish, load } = await nextWish(ctx, vehicle);
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
  if (route) await drive(ctx, { fleet, vehicle, route, load });
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
    const now = await simNow(ctx);
    await maybeReplan(ctx, Date.now());
    if (control.simulateDrivers) await standInDrivers(ctx, now);
    await moveFleet(ctx, now, tickMs);
    return null;
  },
});
