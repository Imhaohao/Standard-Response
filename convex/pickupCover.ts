import { QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// A household whose helper we're calling, or who said they're on the way, doesn't need a van yet.
// Kept apart from pickups.ts so requests.ts can read it without importing the whole pickup check.
export async function helperCovers(ctx: QueryCtx, householdId: Id<"households">) {
  const plans = await ctx.db
    .query("pickupPlans")
    .withIndex("by_householdId", (q) => q.eq("householdId", householdId))
    .take(10);
  return plans.some((plan) => plan.status === "checking" || plan.status === "coming");
}
