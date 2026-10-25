import { MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { located, metersBetween } from "./model";
import { simNow } from "./clock";
import { fitsInACar, Household, Located, REACH_METERS } from "./neighborRules";

// Before the night, the Ready check pairs each real home that said it would need a ride, and fits in
// a car, with the nearest neighbor whose Ready profile says they'd drive out in their own car. Nobody
// has agreed yet. The pair is an `arranged`, `recruited` pickup: on the night the neighbor is asked
// first, once the resident's own call says they can't get out (neighborPickups.ts startPairedAsk),
// then the resident confirms, and both hear updates. Firefighters asked for helpers arranged ahead
// of time instead of strangers scrambled for on the night. Simulated homes get theirs from the
// stand-in (readySim.ts).

const PAIR_WITHIN_METERS = REACH_METERS[0];

const real = (household: Household): household is Located => !household.simulated && located(household);
const wantsRide = (household: Household) => real(household) && household.ready?.exitPlan === "needs_ride" && fitsInACar(household);
const drivesOut = (household: Household) => real(household) && household.ready?.exitPlan === "own_car";

async function plansWhere(ctx: MutationCtx, field: "householdId" | "helperHouseholdId", id: Id<"households">) {
  if (field === "householdId") return await ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", id)).take(20);
  const arranged = await ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", "arranged")).take(500);
  return arranged.filter((plan) => plan.helperHouseholdId === id);
}

// Each neighbor drives for one home at most, and a home has one pickup arranged at a time.
async function pairedHomes(ctx: MutationCtx) {
  const arranged = await ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", "arranged")).take(500);
  return {
    residents: new Set<string>(arranged.map((plan) => plan.householdId)),
    helpers: new Set<string>(arranged.flatMap((plan) => (plan.helperHouseholdId ? [plan.helperHouseholdId] : []))),
  };
}

async function pair(ctx: MutationCtx, resident: Located, driver: Located) {
  const now = await simNow(ctx);
  await ctx.db.insert("pickupPlans", {
    householdId: resident._id,
    helperName: driver.residentName ?? `the neighbor at ${driver.address}`,
    helperPhone: driver.callbackNumber,
    relation: "neighbor",
    helperHouseholdId: driver._id,
    recruited: true,
    status: "arranged",
    helperAttempts: 0,
    residentAttempts: 0,
    updatedAt: now,
    simulated: false,
  });
  await ctx.db.insert("events", {
    kind: "record",
    message: `Paired ${resident.residentName ?? resident.address} with a neighbor on file who has a car, ${Math.round(metersBetween(resident, driver))} m away`,
    householdId: resident._id,
    at: now,
  });
}

function nearest(from: Located, candidates: Located[]) {
  let best: { household: Located; meters: number } | null = null;
  for (const household of candidates) {
    const meters = metersBetween(from, household);
    if (meters <= PAIR_WITHIN_METERS && (!best || meters < best.meters)) best = { household, meters };
  }
  return best?.household ?? null;
}

// A neighbor whose new profile no longer says they'd drive out stops being anyone's pickup.
async function releaseAsHelper(ctx: MutationCtx, household: Household) {
  if (drivesOut(household)) return [];
  const released = (await plansWhere(ctx, "helperHouseholdId", household._id)).filter((plan) => plan.recruited);
  for (const plan of released) await ctx.db.delete("pickupPlans", plan._id);
  return released.map((plan) => plan.householdId);
}

async function pairResident(ctx: MutationCtx, resident: Doc<"households">, homes: Household[]) {
  if (!wantsRide(resident)) return;
  const taken = await pairedHomes(ctx);
  if (taken.residents.has(resident._id)) return;
  const driver = nearest(resident as Located, homes.filter((home) => drivesOut(home) && home._id !== resident._id && !taken.helpers.has(home._id)) as Located[]);
  if (driver) await pair(ctx, resident as Located, driver);
}

async function pairDriver(ctx: MutationCtx, driver: Doc<"households">, homes: Household[]) {
  if (!drivesOut(driver)) return;
  const taken = await pairedHomes(ctx);
  if (taken.helpers.has(driver._id)) return;
  const resident = nearest(driver as Located, homes.filter((home) => wantsRide(home) && !taken.residents.has(home._id)) as Located[]);
  if (resident) await pair(ctx, resident, driver as Located);
}

// After a real home's Ready profile is saved: drop a pairing it can no longer be part of, re-pair
// anyone it was driving for (they were paired first, so they choose first), then pair the home
// itself, as a resident who needs a ride or as a driver.
export async function pairAfterProfile(ctx: MutationCtx, householdId: Id<"households">) {
  const household = await ctx.db.get("households", householdId);
  if (!household || household.simulated) return;
  const orphaned = await releaseAsHelper(ctx, household);
  const homes = (await ctx.db.query("households").take(1000)).filter((home) => !home.simulated);
  for (const id of orphaned) {
    const resident = await ctx.db.get("households", id);
    if (resident) await pairResident(ctx, resident, homes);
  }
  await pairResident(ctx, household, homes);
  await pairDriver(ctx, household, homes);
}
