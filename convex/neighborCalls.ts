import { MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { located, metersBetween } from "./model";
import { QUEUE_STATUSES } from "./callPlans";
import { awayFromTheFire, busyHelpers, canDrive, fitsInACar, Household, Located, REACH_METERS, waitingForANeighbor } from "./neighborRules";

// What one call hears decides which neighbors 911 calls next. A home that can't get out, with no
// neighbor known to have a car close by, moves the uncalled homes around it likeliest to have one to
// the front of the warning-call queue. A neighbor driving out with nobody close by waiting for a ride
// moves the uncalled homes around them likeliest to need one to the front. Either way, the moment
// one of those calls hears the missing half, the neighbor ask (convex/neighborPickups.ts) calls the
// driver and asks them to pick the other home up.

const MAX_CALLS_PER_HOME = 3;
// A home whose need estimate is at least this high is worth calling for a neighbor driving out.
const LIKELY_NEED = 0.4;
const MAX_DUE = 100;

type Want = Doc<"neighborCalls">["want"];
type Nearby = { home: Located; meters: number };

const nameOf = (household: Household) => household.residentName ?? household.address;
const streetOf = (address: string) => address.replace(/^\s*\d+[A-Za-z]?\s+/, "");
const homes = (count: number) => (count === 1 ? "1 home" : `${count} homes`);

async function uncalledHomes(ctx: QueryCtx) {
  const lists = await Promise.all(
    QUEUE_STATUSES.map((callStatus) =>
      ctx.db
        .query("households")
        .withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", callStatus))
        .take(1000),
    ),
  );
  return lists.flat().filter((home): home is Located => home.inZone && located(home));
}

function within(homes: Located[], center: Located, meters: number): Nearby[] {
  return homes
    .filter((home) => home._id !== center._id)
    .map((home) => ({ home, meters: Math.round(metersBetween(center, home)) }))
    .filter((nearby) => nearby.meters <= meters);
}

// Nothing on record says they have no car or count on someone else to drive them.
const mightDrive = (home: Household) =>
  home.hasCar !== false && home.ready?.exitPlan !== "needs_ride" && home.ready?.exitPlan !== "helper";

// The Ready check said they need a ride, or the need estimate says they likely do and nothing says
// they drive. A wheelchair or lift on record that a car can't take rules them out.
function mightNeedARide(home: Household) {
  if (!fitsInACar(home) || home.hasCar === true || home.ready?.exitPlan === "own_car") return false;
  return home.ready?.exitPlan === "needs_ride" || home.needProbability >= LIKELY_NEED;
}

// A Ready check "I drive" first, then nearest.
const driversFirst = (a: Nearby, b: Nearby) =>
  Number(b.home.ready?.exitPlan === "own_car") - Number(a.home.ready?.exitPlan === "own_car") || a.meters - b.meters;

// A Ready check "I need a ride" first, then likeliest to need one, then nearest.
const ridersFirst = (a: Nearby, b: Nearby) =>
  Number(b.home.ready?.exitPlan === "needs_ride") - Number(a.home.ready?.exitPlan === "needs_ride") ||
  b.home.needProbability - a.home.needProbability ||
  a.meters - b.meters;

// Queues up to three calls for this home, skipping homes already queued for any neighbor. Calls
// queued earlier that haven't been placed yet count toward the three.
async function queueCalls(ctx: MutationCtx, cause: Household, want: Want, nearby: Nearby[], reasonFor: (n: Nearby) => string, now: number) {
  const uncalled = new Set(nearby.map(({ home }) => home._id));
  const earlier = await ctx.db
    .query("neighborCalls")
    .withIndex("by_forHouseholdId", (q) => q.eq("forHouseholdId", cause._id))
    .take(50);
  let room = MAX_CALLS_PER_HOME - earlier.filter((row) => row.want === want && uncalled.has(row.householdId)).length;
  let queued = 0;
  for (const candidate of nearby) {
    if (room <= 0) break;
    const existing = await ctx.db
      .query("neighborCalls")
      .withIndex("by_householdId", (q) => q.eq("householdId", candidate.home._id))
      .first();
    if (existing) continue;
    await ctx.db.insert("neighborCalls", { householdId: candidate.home._id, forHouseholdId: cause._id, want, reason: reasonFor(candidate), at: now });
    room -= 1;
    queued += 1;
  }
  return queued;
}

// A home waiting for a neighbor with nobody driving close by: call the homes around it that may
// have a car, within the circle it is searching now. The search widening calls further out.
export async function callDriversNear(ctx: MutationCtx, resident: Located, reachMeters: number, now: number) {
  const nearby = within(await uncalledHomes(ctx), resident, reachMeters)
    .filter(({ home }) => mightDrive(home) && awayFromTheFire(home, resident))
    .sort(driversFirst);
  const reason = ({ meters }: Nearby) => `May have a car to pick up ${nameOf(resident)}, ${meters} m away, who can't get out`;
  const queued = await queueCalls(ctx, resident, "driver", nearby, reason, now);
  if (queued === 0) return;
  await ctx.db.insert("events", {
    kind: "dispatch",
    message: `Calling ${homes(queued)} near ${nameOf(resident)} next, to find a neighbor with a car`,
    householdId: resident._id,
    at: now,
  });
}

// A neighbor driving out with nobody close by waiting for one: call the homes around them likeliest
// to need a ride. Only homes the fire reaches no sooner than the driver, so going for them is
// driving away from it.
export async function callRidersNear(ctx: MutationCtx, driver: Located, now: number) {
  const nearby = within(await uncalledHomes(ctx), driver, REACH_METERS[0])
    .filter(({ home }) => mightNeedARide(home) && awayFromTheFire(driver, home))
    .sort(ridersFirst);
  const reason = ({ meters }: Nearby) => `May need a ride. ${nameOf(driver)}, ${meters} m away, is driving out and could take them`;
  const queued = await queueCalls(ctx, driver, "rider", nearby, reason, now);
  if (queued === 0) return;
  await ctx.db.insert("events", {
    kind: "dispatch",
    message: `${nameOf(driver)} is driving out of ${streetOf(driver.address)}. Calling ${homes(queued)} nearby that may need a ride`,
    householdId: driver._id,
    at: now,
  });
}

// The home this call is for still needs it: a resident nobody is on the way to yet, or a driver
// still free to go for someone.
function stillNeeded(row: Doc<"neighborCalls">, cause: Household | null, coming: Set<string>, busy: Set<string>) {
  if (row.want === "driver") return waitingForANeighbor(cause) && !coming.has(cause._id);
  return cause !== null && canDrive(cause) && !busy.has(cause._id);
}

// Homes with a helper who agreed ahead of time or said they're on the way.
async function helpedHomes(ctx: QueryCtx) {
  const helped = new Set<string>();
  for (const status of ["arranged", "coming"] as const) {
    const plans = await ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(200);
    for (const plan of plans) helped.add(plan.householdId);
  }
  return helped;
}

// Neighbor calls still worth placing, oldest first, with the reason for each. nextToCall dials these
// ahead of everything else, since each is half of a ride that is waiting on it.
export async function neighborCallsDue(ctx: QueryCtx): Promise<Map<Id<"households">, string>> {
  const rows = await ctx.db.query("neighborCalls").withIndex("by_at").take(MAX_DUE);
  const [coming, busy] = await Promise.all([helpedHomes(ctx), busyHelpers(ctx)]);
  const due = new Map<Id<"households">, string>();
  for (const row of rows) {
    if (stillNeeded(row, await ctx.db.get("households", row.forHouseholdId), coming, busy)) due.set(row.householdId, row.reason);
  }
  return due;
}

// The call is being placed, so the home has left the queue this row put it at the front of.
export async function clearNeighborCalls(ctx: MutationCtx, householdId: Id<"households">) {
  const rows = await ctx.db
    .query("neighborCalls")
    .withIndex("by_householdId", (q) => q.eq("householdId", householdId))
    .take(10);
  for (const row of rows) await ctx.db.delete("neighborCalls", row._id);
}
