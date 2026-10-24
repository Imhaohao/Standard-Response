import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const forHousehold = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) =>
    await ctx.db.query("texts").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(100),
});

export const recent = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => await ctx.db.query("texts").order("desc").take(limit),
});

// Voice track: an outbound text to a resident.
export const send = mutation({
  args: { householdId: v.id("households"), body: v.string() },
  returns: v.id("texts"),
  handler: async (ctx, args) => await ctx.db.insert("texts", { ...args, direction: "outbound", at: Date.now() }),
});

// Simulated phone panel: a resident's reply. The voice track parses it.
export const reply = mutation({
  args: { householdId: v.id("households"), body: v.string() },
  returns: v.id("texts"),
  handler: async (ctx, args) => await ctx.db.insert("texts", { ...args, direction: "inbound", at: Date.now() }),
});
