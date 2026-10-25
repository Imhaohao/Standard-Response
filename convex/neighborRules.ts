import { QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { located } from "./model";

// Who counts as a neighbor driver and who as a home waiting for one. Shared by the neighbor ask
// (convex/neighborPickups.ts) and the neighbor calls it leads to (convex/neighborCalls.ts).

export type Household = Doc<"households">;
export type Located = Household & { lat: number; lng: number };

// The circle starts small, so the first call goes to someone a few doors away, and widens only after
// everyone in it has said no or not answered and three minutes pass with nobody on the way.
export const REACH_METERS = [900, 1600, 2400];

// A neighbor's car can't carry a power wheelchair or someone who has to be lifted by two people.
export function fitsInACar(household: Household) {
  if (household.mobility === "power_wheelchair" || household.mobility === "bedbound") return false;
  return household.assistanceRequired !== "two_person_lift";
}

// Someone answered "can you leave?" tonight, so we know the person is home and stuck. An old Ready
// check answer alone never sends a neighbor to a house that may be empty.
const needsRide = (household: Household) =>
  (household.outcome === "needs_ride" || household.outcome === "needs_accessible") && household.canLeave !== undefined;

// Has a car, by tonight's call or the Ready check.
export function canDrive(household: Household) {
  if (!household.callbackNumber) return false;
  const hasCar = household.hasCar === true || household.ready?.exitPlan === "own_car";
  return hasCar && (household.outcome === "leaving" || household.outcome === "unknown");
}

// Palo Alto Fire told us a neighbor sent back for someone can end up "going backwards" into the
// danger zone. So we only ask a neighbor the fire reaches no later than the resident: driving over
// to pick them up is then driving away from the fire. That also leaves out a neighbor outside the
// warning zone, who would have to drive in.
export const awayFromTheFire = (neighbor: Household, resident: Household) => neighbor.fireArrivalAt <= resident.fireArrivalAt;

export const waitingForANeighbor = (resident: Household | null): resident is Located =>
  resident !== null && resident.inZone && needsRide(resident) && fitsInACar(resident) && located(resident);

export const reachOf = (resident: Household) => resident.neighborSearch?.reachMeters ?? REACH_METERS[0];

// Neighbors 911 is asking right now, or who said they're on their way to someone.
export async function busyHelpers(ctx: QueryCtx) {
  const busy = new Set<string>();
  for (const status of ["checking", "coming"] as const) {
    const live = await ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(200);
    for (const plan of live) if (plan.helperHouseholdId) busy.add(plan.helperHouseholdId);
  }
  return busy;
}
