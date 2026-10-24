import { MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { located, metersBetween } from "./model";

// When tonight's call hears that someone can't get out and nobody agreed ahead of time to come for
// them, 911 calls the nearest neighbor with a car straight away and asks them to pick the person up.
// The ride request stays open the whole time: crews are likely swamped, so a neighbor is a faster
// first try, never a reason to hold a van. Each "no" or missed call moves on to the next neighbor.

const NEIGHBOR_RADIUS_METERS = 800;
const MAX_NEIGHBORS_ASKED = 3;
const LIVE: Doc<"pickupPlans">["status"][] = ["arranged", "checking", "coming"];

type Household = Doc<"households">;
type Located = Household & { lat: number; lng: number };

// A neighbor's car can't carry a power wheelchair or someone who has to be lifted by two people.
function fitsInACar(household: Household) {
  if (household.mobility === "power_wheelchair" || household.mobility === "bedbound") return false;
  return household.assistanceRequired !== "two_person_lift";
}

// Someone answered "can you leave?" tonight, so we know the person is home and stuck. An old Ready
// check answer alone never sends a neighbor to a house that may be empty.
const needsRide = (household: Household) =>
  (household.outcome === "needs_ride" || household.outcome === "needs_accessible") && household.canLeave !== undefined;

// Has a car, by tonight's call or the Ready check. A neighbor just outside the warning zone counts
// too: they aren't evacuating, so they're free to drive over.
function canDrive(household: Household) {
  if (!household.callbackNumber) return false;
  const hasCar = household.hasCar === true || household.ready?.exitPlan === "own_car";
  return hasCar && (household.outcome === "leaving" || household.outcome === "unknown");
}

const DRIVER_OUTCOMES = ["leaving", "unknown"] as const;

// Neighbors 911 is asking right now, or who said they're on their way to someone.
export async function busyHelpers(ctx: QueryCtx) {
  const busy = new Set<string>();
  for (const status of ["checking", "coming"] as const) {
    const live = await ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(200);
    for (const plan of live) if (plan.helperHouseholdId) busy.add(plan.helperHouseholdId);
  }
  return busy;
}

async function nearestDriver(ctx: MutationCtx, resident: Located, skip: Set<string>) {
  const lists = await Promise.all(
    DRIVER_OUTCOMES.map((outcome) => ctx.db.query("households").withIndex("by_outcome", (q) => q.eq("outcome", outcome)).take(1000)),
  );
  let best: { household: Household; meters: number } | null = null;
  for (const household of lists.flat()) {
    if (household._id === resident._id || skip.has(household._id) || !canDrive(household) || !located(household)) continue;
    const meters = metersBetween(resident, household);
    if (meters <= NEIGHBOR_RADIUS_METERS && (!best || meters < best.meters)) best = { household, meters };
  }
  return best?.household ?? null;
}

const streetOf = (address: string) => address.replace(/^\s*\d+[A-Za-z]?\s+/, "");

const waitingForANeighbor = (resident: Household | null): resident is Located =>
  resident !== null && resident.inZone && needsRide(resident) && fitsInACar(resident) && located(resident);

// Nobody is already being asked or on the way, and we haven't run through our neighbors yet.
const mayAskAnother = (plans: Doc<"pickupPlans">[]) =>
  !plans.some((plan) => LIVE.includes(plan.status)) && plans.filter((plan) => plan.recruited).length < MAX_NEIGHBORS_ASKED;

export async function askNearbyDriver(ctx: MutationCtx, householdId: Id<"households">) {
  const resident = await ctx.db.get("households", householdId);
  if (!waitingForANeighbor(resident)) return;
  const plans = await ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(20);
  if (!mayAskAnother(plans)) return;
  const skip = await busyHelpers(ctx);
  for (const plan of plans) if (plan.helperHouseholdId) skip.add(plan.helperHouseholdId);
  const neighbor = await nearestDriver(ctx, resident, skip);
  if (!neighbor) return;
  const now = Date.now();
  await ctx.db.insert("pickupPlans", {
    householdId,
    helperName: neighbor.residentName ?? `the neighbor at ${neighbor.address}`,
    helperPhone: neighbor.callbackNumber,
    relation: "neighbor",
    helperHouseholdId: neighbor._id,
    recruited: true,
    status: "checking",
    helperAttempts: 0,
    residentAttempts: 0,
    checkStartedAt: now,
    updatedAt: now,
    simulated: resident.simulated || neighbor.simulated,
  });
  await ctx.db.insert("events", {
    kind: "dispatch",
    message: `Asking a neighbor on ${streetOf(neighbor.address)} to pick up ${resident.residentName ?? resident.address}`,
    householdId,
    at: now,
  });
}
