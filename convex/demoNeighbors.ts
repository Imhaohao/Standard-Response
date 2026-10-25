import { MutationCtx, QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { canDrive } from "./neighborRules";
import { located, metersBetween } from "./model";
import { simNow } from "./clock";

const LIVE = ["arranged", "checking", "coming"] as const;

// Count kiosk participants, not the seeded town or ordinary Ready sign-ups. The
// bounded read also makes ten participants a strict boundary for the demo fallback.
async function smallDemoHomes(ctx: QueryCtx) {
  const claims = await ctx.db.query("claims").take(10);
  if (claims.length >= 10) return [];
  const homes = await Promise.all(claims.map(async (claim) => {
    const home = await ctx.db.get("households", claim.householdId);
    return home && !home.simulated && home.callbackNumber === claim.phone ? home : null;
  }));
  return homes.filter((home) => home !== null).filter(located);
}

// Only two current kiosk participants get the relaxed demo rules. Ordinary
// residents and helpers retain their mobility, distance and fire-direction checks.
export async function isSmallDemoPair(ctx: QueryCtx, plan: Doc<"pickupPlans">) {
  if (!plan.recruited || !plan.helperHouseholdId) return false;
  const ids = new Set((await smallDemoHomes(ctx)).map((home) => home._id));
  return ids.has(plan.householdId) && ids.has(plan.helperHouseholdId);
}

async function mayPair(ctx: QueryCtx, resident: Doc<"households">, covered: Set<Doc<"households">["_id"]>) {
  if (resident.away || resident.canLeave !== "no" || covered.has(resident._id)) return false;
  const claim = await ctx.db.query("claims").withIndex("by_householdId", (q) => q.eq("householdId", resident._id)).first();
  const previous = await ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", resident._id)).take(20);
  return !previous.some((plan) => plan._creationTime >= (claim?.claimedAt ?? 0) && (plan.reason === "resident_declined" || plan.status === "done"));
}

export async function pairSmallDemo(ctx: MutationCtx) {
  const homes = await smallDemoHomes(ctx);
  if (homes.length < 2) return;
  const lists = await Promise.all(LIVE.map((status) =>
    ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(500),
  ));
  const plans = lists.flat();
  const covered = new Set(plans.map((plan) => plan.householdId));
  const busy = new Set(plans.flatMap((plan) => plan.helperHouseholdId ? [plan.helperHouseholdId] : []));
  const drivers = homes.filter((home) => canDrive(home) && !busy.has(home._id));
  const warning = (await ctx.db.query("control").first())?.warningIssuedAt !== undefined;
  for (const resident of homes) {
    if (!(await mayPair(ctx, resident, covered))) continue;
    drivers.sort((a, b) => metersBetween(resident, a) - metersBetween(resident, b));
    const driver = drivers.shift();
    if (!driver) break;
    const now = await simNow(ctx);
    const checking = warning && resident.inZone;
    await ctx.db.insert("pickupPlans", {
      householdId: resident._id,
      helperHouseholdId: driver._id,
      helperName: driver.residentName ?? `the neighbor at ${driver.address}`,
      helperPhone: driver.callbackNumber,
      relation: "neighbor",
      recruited: true,
      status: checking ? "checking" : "arranged",
      checkStartedAt: checking ? now : undefined,
      helperAttempts: 0,
      residentAttempts: 0,
      updatedAt: now,
      simulated: false,
    });
    await ctx.db.insert("events", {
      kind: "record",
      message: `Demo: paired ${resident.residentName ?? resident.address} with ${driver.residentName ?? driver.address} to ask for help`,
      householdId: resident._id,
      at: now,
    });
  }
}
