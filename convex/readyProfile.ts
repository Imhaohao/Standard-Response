import { MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { callPriorityFor } from "./model";

// Writing a Ready check profile. Shared by the resident's sign-up page, the agent's Ready check call
// and the stand-in. The record fields are written straight to the household without touching
// `outcome`: a profile never opens a ride request by itself, only a warning does. The evening call
// then confirms them as "on file".

type Household = Doc<"households">;
export type ReadyProfile = NonNullable<Household["ready"]>;
export type RecordFields = Partial<Pick<Household, "residentName" | "peopleCount" | "mobility" | "assistanceRequired" | "medical" | "pets" | "hasCar">>;
export type Helper = { name: string; phone: string; relation?: string };

const KNOWN_NEED_PRIOR = 0.9;
const KNOWN_FINE_PRIOR = 0.1;

const LIMITED = new Set(["walker", "manual_wheelchair", "power_wheelchair", "bedbound"]);

// Someone who would need a van if their own plan fell through.
export function needsHelp(record: RecordFields, exitPlan: ReadyProfile["exitPlan"]) {
  if (exitPlan !== "own_car") return true;
  if (record.mobility && LIMITED.has(record.mobility)) return true;
  if (record.medical?.includes("oxygen") || record.assistanceRequired === "two_person_lift") return true;
  return record.hasCar === false;
}

// What the household told us is known need, like the rider list, so the call queue reaches them first.
function priorsFor(household: Household, record: RecordFields, ready: ReadyProfile, now: number) {
  const needPrior = needsHelp(record, ready.exitPlan) ? KNOWN_NEED_PRIOR : KNOWN_FINE_PRIOR;
  return { needPrior, needProbability: needPrior, callPriority: callPriorityFor(needPrior, household.fireArrivalAt, now) };
}

async function phoneOwner(ctx: MutationCtx, phone: string) {
  return await ctx.db
    .query("households")
    .withIndex("by_callbackNumber", (q) => q.eq("callbackNumber", phone))
    .first();
}

// One arranged pickup per household: a new answer replaces the old one, and "own car" or "a ride
// from you" removes it. Pickups already being checked on the night are left alone.
async function arrangePickup(ctx: MutationCtx, household: Household, helper: Helper | undefined, simulated: boolean) {
  const existing = await ctx.db
    .query("pickupPlans")
    .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
    .take(10);
  for (const plan of existing) if (plan.status === "arranged") await ctx.db.delete("pickupPlans", plan._id);
  if (!helper || existing.some((plan) => plan.status !== "arranged")) return;
  const helperHome = await phoneOwner(ctx, helper.phone);
  await ctx.db.insert("pickupPlans", {
    householdId: household._id,
    helperName: helper.name,
    helperPhone: helper.phone,
    relation: helper.relation,
    helperHouseholdId: helperHome && helperHome._id !== household._id ? helperHome._id : undefined,
    status: "arranged",
    helperAttempts: 0,
    residentAttempts: 0,
    updatedAt: Date.now(),
    simulated,
  });
}

export async function saveProfile(
  ctx: MutationCtx,
  householdId: Id<"households">,
  profile: { record: RecordFields; ready: ReadyProfile; helper?: Helper },
) {
  const household = await ctx.db.get("households", householdId);
  if (!household) throw new Error(`Household ${householdId} not found`);
  const now = Date.now();
  await ctx.db.patch("households", householdId, {
    ...profile.record,
    ready: profile.ready,
    ...priorsFor(household, profile.record, profile.ready, now),
  });
  const helper = profile.ready.exitPlan === "helper" ? profile.helper : undefined;
  await arrangePickup(ctx, household, helper, household.simulated);
}
