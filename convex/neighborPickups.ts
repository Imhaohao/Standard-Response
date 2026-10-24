import { MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { located, metersBetween } from "./model";

// When a home needs a ride and nobody agreed ahead of time to come for them, 911 asks the nearest
// neighbor who is driving out to pick them up on the way. The ride request stays open the whole
// time: crews are likely swamped, so a neighbor is a faster first try, never a reason to hold a van.
// Each "no" or missed call moves on to the next neighbor, up to a few.

const NEIGHBOR_RADIUS_METERS = 800;
const MAX_NEIGHBORS_ASKED = 3;
const LIVE: Doc<"pickupPlans">["status"][] = ["arranged", "checking", "coming"];

type Household = Doc<"households">;

// A neighbor's car can't carry a power wheelchair or someone who has to be lifted by two people.
function fitsInACar(household: Household) {
  if (household.mobility === "power_wheelchair" || household.mobility === "bedbound") return false;
  return household.assistanceRequired !== "two_person_lift";
}

// Said so on tonight's call, or, before that call reaches them, in the Ready check.
function needsRide(household: Household) {
  if (household.outcome === "needs_ride" || household.outcome === "needs_accessible") return true;
  return household.outcome === "unknown" && household.ready?.exitPlan === "needs_ride";
}

// Leaving in a car of their own, by tonight's call or by the Ready check.
function drivingOut(household: Household) {
  if (!household.inZone || !household.callbackNumber) return false;
  if (household.outcome === "leaving") return household.hasCar === true || household.ready?.exitPlan === "own_car";
  return household.outcome === "unknown" && household.ready?.exitPlan === "own_car";
}

const DRIVER_OUTCOMES = ["leaving", "unknown"] as const;
const RIDER_OUTCOMES = ["needs_ride", "needs_accessible", "unknown"] as const;

async function plansFor(ctx: MutationCtx, householdId: Id<"households">) {
  return await ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(20);
}

// Everyone who could drive a neighbor out, and those already on their way to someone. Loaded once
// per sweep so a whole zone's worth of asks reads the households table once.
type DriverPool = { drivers: (Household & { lat: number; lng: number })[]; busy: Set<string> };

async function householdsWith(ctx: MutationCtx, outcomes: readonly Household["outcome"][]) {
  const lists = await Promise.all(outcomes.map((outcome) => ctx.db.query("households").withIndex("by_outcome", (q) => q.eq("outcome", outcome)).take(1000)));
  return lists.flat();
}

async function driverPool(ctx: MutationCtx): Promise<DriverPool> {
  const drivers = (await householdsWith(ctx, DRIVER_OUTCOMES)).filter(drivingOut).filter(located);
  const busy = new Set<string>();
  for (const status of ["checking", "coming"] as const) {
    const live = await ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(200);
    for (const plan of live) if (plan.helperHouseholdId) busy.add(plan.helperHouseholdId);
  }
  return { drivers, busy };
}

function nearestDriver(pool: DriverPool, resident: Household & { lat: number; lng: number }, alreadyAsked: Set<string>) {
  let best: { household: Household; meters: number } | null = null;
  for (const household of pool.drivers) {
    if (household._id === resident._id || pool.busy.has(household._id) || alreadyAsked.has(household._id)) continue;
    const meters = metersBetween(resident, household);
    if (meters <= NEIGHBOR_RADIUS_METERS && (!best || meters < best.meters)) best = { household, meters };
  }
  return best?.household ?? null;
}

const streetOf = (address: string) => address.replace(/^\s*\d+[A-Za-z]?\s+/, "");

export async function askNearbyDriver(ctx: MutationCtx, householdId: Id<"households">, pool?: DriverPool) {
  const resident = await ctx.db.get("households", householdId);
  if (!resident?.inZone || !needsRide(resident) || !fitsInACar(resident) || !located(resident)) return;
  const plans = await plansFor(ctx, householdId);
  if (plans.some((plan) => LIVE.includes(plan.status))) return;
  if (plans.filter((plan) => plan.recruited).length >= MAX_NEIGHBORS_ASKED) return;
  const alreadyAsked = new Set<string>(plans.flatMap((plan) => (plan.helperHouseholdId ? [plan.helperHouseholdId] : [])));
  const drivers = pool ?? (await driverPool(ctx));
  const neighbor = nearestDriver(drivers, resident, alreadyAsked);
  if (!neighbor) return;
  drivers.busy.add(neighbor._id);
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
    message: `Asking a neighbor on ${streetOf(neighbor.address)} to pick up ${resident.residentName ?? resident.address} on their way out`,
    householdId,
    at: now,
  });
}

// The warning just went out: homes already known to need a ride get a neighbor asked straight away.
export async function askNeighborsForWaitingHomes(ctx: MutationCtx) {
  const pool = await driverPool(ctx);
  for (const household of await householdsWith(ctx, RIDER_OUTCOMES)) {
    if (household.inZone && needsRide(household)) await askNearbyDriver(ctx, household._id, pool);
  }
}
