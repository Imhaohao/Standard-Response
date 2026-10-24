import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Voice agent: "Is there anyone else on your street who might not be able to leave?"
export const add = mutation({
  args: { fromHouseholdId: v.optional(v.id("households")), spokenAddress: v.string() },
  returns: v.id("nominations"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("nominations", { ...args, status: "open", at: Date.now() });
  },
});

export const open = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("nominations").withIndex("by_status", (q) => q.eq("status", "open")).take(200),
});

// Track D matched the spoken address to a household, or couldn't.
export const resolve = mutation({
  args: { nominationId: v.id("nominations"), matchedHouseholdId: v.optional(v.id("households")) },
  returns: v.null(),
  handler: async (ctx, { nominationId, matchedHouseholdId }) => {
    await ctx.db.patch("nominations", nominationId, {
      status: matchedHouseholdId ? "matched" : "unmatched",
      matchedHouseholdId,
    });
    return null;
  },
});
