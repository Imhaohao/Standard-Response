import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { metersBetween, Point } from "./model";
import { closedEdgeSet, edgePath, EDGES, nearestNode, shortestPathsFrom } from "./roadGraph";

// The road miles of a volunteer's pickup: from the volunteer's home (when they live in the area) to
// the resident, then on to the nearest shelter the roads still reach. Each leg is the fastest
// free-flow path around confirmed closures, the same graph the vans drive. A leg the graph can't
// route is measured in a straight line, and the whole trip is marked so.

const METERS_PER_MILE = 1609.344;

export type RouteMiles = { miles: number; distanceSource: "road" | "straight_line" };

const located = (household: Doc<"households"> | null): Point | null =>
  household?.lat !== undefined && household.lng !== undefined ? { lat: household.lat, lng: household.lng } : null;

const pathMeters = (edges: number[]) => edges.reduce((sum, edge) => sum + EDGES[edge].meters, 0);

type Leg = { meters: number; byRoad: boolean };

function legBetween(from: Point, to: Point, closed: ReadonlySet<number>): Leg {
  const edges = edgePath(shortestPathsFrom(nearestNode(from), closed), nearestNode(to));
  return edges ? { meters: pathMeters(edges), byRoad: true } : { meters: metersBetween(from, to), byRoad: false };
}

function legToNearestShelter(from: Point, shelters: Doc<"shelters">[], closed: ReadonlySet<number>): Leg | null {
  if (shelters.length === 0) return null;
  const paths = shortestPathsFrom(nearestNode(from), closed);
  const reachable = shelters
    .map((shelter) => ({ node: nearestNode(shelter) }))
    .filter(({ node }) => Number.isFinite(paths.seconds[node]))
    .sort((a, b) => paths.seconds[a.node] - paths.seconds[b.node]);
  const edges = reachable[0] && edgePath(paths, reachable[0].node);
  if (edges) return { meters: pathMeters(edges), byRoad: true };
  const nearest = Math.min(...shelters.map((shelter) => metersBetween(from, shelter)));
  return { meters: nearest, byRoad: false };
}

export async function completedRouteMiles(ctx: MutationCtx, plan: Doc<"pickupPlans">): Promise<RouteMiles> {
  const resident = located(await ctx.db.get("households", plan.householdId));
  if (!resident) return { miles: 0, distanceSource: "straight_line" };
  const helper = plan.helperHouseholdId ? located(await ctx.db.get("households", plan.helperHouseholdId)) : null;
  const closures = await ctx.db.query("roadClosures").take(1000);
  const closed = closedEdgeSet(closures.filter((closure) => closure.confirmed));
  const shelters = await ctx.db.query("shelters").take(50);
  const legs = [helper ? legBetween(helper, resident, closed) : null, legToNearestShelter(resident, shelters, closed)].filter(
    (leg): leg is Leg => leg !== null,
  );
  const meters = legs.reduce((sum, leg) => sum + leg.meters, 0);
  return {
    miles: Math.round((meters / METERS_PER_MILE) * 10) / 10,
    distanceSource: legs.length > 0 && legs.every((leg) => leg.byRoad) ? "road" : "straight_line",
  };
}
