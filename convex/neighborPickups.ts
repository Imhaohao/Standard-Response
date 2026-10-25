import { MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { located, metersBetween } from "./model";
import { simNow } from "./clock";
import { callDriversNear, callRidersNear } from "./neighborCalls";
import { awayFromTheFire, busyHelpers, canDrive, Household, Located, REACH_METERS, reachOf, waitingForANeighbor } from "./neighborRules";

// When tonight's call hears that someone can't get out and nobody agreed ahead of time to come for
// them, 911 calls the nearest neighbor with a car straight away and asks them to pick the person up,
// first within 900 m and then in wider circles.
// The ride request stays open the whole time: crews are likely swamped, so a neighbor is a faster
// first try, never a reason to hold a van. Each "no" or missed call moves on to the next neighbor.

const WIDEN_AFTER_MS = 3 * 60_000;
const MAX_NEIGHBORS_ASKED = 6;
const LIVE: Doc<"pickupPlans">["status"][] = ["arranged", "checking", "coming"];

const DRIVER_OUTCOMES = ["leaving", "unknown"] as const;
const WAITING_OUTCOMES = ["needs_ride", "needs_accessible"] as const;

function mayAsk(household: Household, resident: Located, skip: Set<string>): household is Located {
  if (household._id === resident._id || skip.has(household._id)) return false;
  return canDrive(household) && located(household) && awayFromTheFire(household, resident);
}

async function nearestDriver(ctx: MutationCtx, resident: Located, skip: Set<string>, reachMeters: number) {
  const lists = await Promise.all(
    DRIVER_OUTCOMES.map((outcome) => ctx.db.query("households").withIndex("by_outcome", (q) => q.eq("outcome", outcome)).take(1000)),
  );
  let best: { household: Household; meters: number } | null = null;
  for (const household of lists.flat()) {
    if (!mayAsk(household, resident, skip)) continue;
    const meters = metersBetween(resident, household);
    if (meters <= reachMeters && (!best || meters < best.meters)) best = { household, meters };
  }
  return best?.household ?? null;
}

const streetOf = (address: string) => address.replace(/^\s*\d+[A-Za-z]?\s+/, "");

const kilometers = (meters: number) => (meters < 1000 ? `${meters} m` : `${meters / 1000} km`);

// Nobody left in this circle to ask. The clock on widening starts the first time we find that.
async function goQuiet(ctx: MutationCtx, resident: Located, reachMeters: number, now: number) {
  if (resident.neighborSearch?.idleSince !== undefined && resident.neighborSearch.reachMeters === reachMeters) return;
  await ctx.db.patch("households", resident._id, { neighborSearch: { reachMeters, idleSince: now } });
}

const nextReach = (reachMeters: number) => REACH_METERS.find((meters) => meters > reachMeters);

// Night tick: a home whose circle has been quiet for three minutes gets a wider one, and the
// nearest neighbor in it is called straight away.
export async function widenQuietSearches(ctx: MutationCtx, now: number) {
  for (const outcome of WAITING_OUTCOMES) {
    const waiting = await ctx.db.query("households").withIndex("by_outcome", (q) => q.eq("outcome", outcome)).take(300);
    for (const household of waiting) await widenIfQuiet(ctx, household, now);
  }
}

async function widenIfQuiet(ctx: MutationCtx, household: Household, now: number) {
  const search = household.neighborSearch;
  if (search?.idleSince === undefined || now - search.idleSince < WIDEN_AFTER_MS) return;
  const reachMeters = nextReach(search.reachMeters);
  if (reachMeters === undefined) return;
  await ctx.db.patch("households", household._id, { neighborSearch: { reachMeters } });
  await ctx.db.insert("events", {
    kind: "dispatch",
    message: `No neighbor within ${kilometers(search.reachMeters)} of ${household.residentName ?? household.address} is on the way. Looking out to ${kilometers(reachMeters)}`,
    householdId: household._id,
    at: now,
  });
  await askNearbyDriver(ctx, household._id);
}

// Nobody is already being asked or on the way, the resident hasn't turned down a neighbor's ride,
// and we haven't run through our neighbors yet.
const mayAskAnother = (plans: Doc<"pickupPlans">[]) =>
  !plans.some((plan) => LIVE.includes(plan.status) || plan.reason === "resident_declined") &&
  plans.filter((plan) => plan.recruited).length < MAX_NEIGHBORS_ASKED;

const plansFor = (ctx: QueryCtx, householdId: Id<"households">) =>
  ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(20);

async function askToPickUp(ctx: MutationCtx, resident: Located, neighbor: Household, reachMeters: number, now: number) {
  await ctx.db.patch("households", resident._id, { neighborSearch: { reachMeters } });
  await ctx.db.insert("pickupPlans", {
    householdId: resident._id,
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
    householdId: resident._id,
    at: now,
  });
}

export async function askNearbyDriver(ctx: MutationCtx, householdId: Id<"households">) {
  const resident = await ctx.db.get("households", householdId);
  if (!waitingForANeighbor(resident)) return;
  const plans = await plansFor(ctx, householdId);
  if (!mayAskAnother(plans)) return;
  const skip = await busyHelpers(ctx);
  for (const plan of plans) if (plan.helperHouseholdId) skip.add(plan.helperHouseholdId);
  const now = await simNow(ctx);
  const reachMeters = reachOf(resident);
  const neighbor = await nearestDriver(ctx, resident, skip, reachMeters);
  if (neighbor) return await askToPickUp(ctx, resident, neighbor, reachMeters, now);
  await goQuiet(ctx, resident, reachMeters, now);
  await callDriversNear(ctx, resident, reachMeters, now);
}

// Homes still waiting for a neighbor that this driver is close enough to ask, nearest first.
async function waitingNear(ctx: QueryCtx, driver: Located) {
  const lists = await Promise.all(
    WAITING_OUTCOMES.map((outcome) => ctx.db.query("households").withIndex("by_outcome", (q) => q.eq("outcome", outcome)).take(300)),
  );
  return lists
    .flat()
    .filter(waitingForANeighbor)
    .map((resident) => ({ resident, meters: metersBetween(resident, driver) }))
    .filter(({ resident, meters }) => meters <= reachOf(resident) && mayAsk(driver, resident, new Set()))
    .sort((a, b) => a.meters - b.meters)
    .map(({ resident }) => resident);
}

// A home that can't get out is asked about the moment its own call hears it, but a neighbor whose
// call hasn't yet said they have a car isn't a driver then. So when a call turns someone into a
// driver, the nearest home still waiting for one asks them straight away, instead of only finding
// them three minutes later when its circle widens. With nobody waiting nearby yet, the homes around
// them likeliest to need a ride are called next.
export async function askNewDriver(ctx: MutationCtx, before: Household) {
  const driver = await ctx.db.get("households", before._id);
  if (canDrive(before) || !driver || !canDrive(driver) || !located(driver)) return;
  if ((await busyHelpers(ctx)).has(driver._id)) return;
  const now = await simNow(ctx);
  for (const resident of await waitingNear(ctx, driver)) {
    const plans = await plansFor(ctx, resident._id);
    if (!mayAskAnother(plans) || plans.some((plan) => plan.helperHouseholdId === driver._id)) continue;
    return await askToPickUp(ctx, resident, driver, reachOf(resident), now);
  }
  await callRidersNear(ctx, driver, now);
}
