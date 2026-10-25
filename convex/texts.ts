import { v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { simNow } from "./clock";
import { stopLadder } from "./reachLadder";

export const forHousehold = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) =>
    await ctx.db.query("texts").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(100),
});

export const recent = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => await ctx.db.query("texts").order("desc").take(limit),
});

// Voice server: an outbound text to a resident.
export const send = mutation({
  args: { householdId: v.id("households"), body: v.string() },
  returns: v.id("texts"),
  handler: async (ctx, args) => await ctx.db.insert("texts", { ...args, direction: "outbound", at: await simNow(ctx) }),
});

// Simulated phone panel: a resident's reply. The voice server parses it. A reply ends the reach
// ladder at once, so no door check follows while the reply is being read.
export const reply = mutation({
  args: { householdId: v.id("households"), body: v.string() },
  returns: v.id("texts"),
  handler: async (ctx, args) => {
    const textId = await ctx.db.insert("texts", { ...args, direction: "inbound", at: await simNow(ctx) });
    const household = await ctx.db.get("households", args.householdId);
    if (household?.ladder?.step === "awaiting_reply") await stopLadder(ctx, household._id, "replied");
    return textId;
  },
});

// Simulated phone panel: one thread per household, newest first.
export const threads = query({
  args: {},
  handler: async (ctx) => {
    const texts = await ctx.db.query("texts").order("desc").take(500);
    const byHousehold = new Map<string, typeof texts>();
    for (const text of texts) byHousehold.set(text.householdId, [...(byHousehold.get(text.householdId) ?? []), text]);
    return await Promise.all(
      [...byHousehold.values()].map(async (thread) => {
        const household = await ctx.db.get("households", thread[0].householdId);
        return {
          householdId: thread[0].householdId,
          address: household?.address ?? "Unknown address",
          residentName: household?.residentName,
          texts: thread.reverse(),
        };
      }),
    );
  },
});
