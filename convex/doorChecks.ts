import { v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";

// Track D's door-check score. Send any subset of households, as often as you like.
export const setPriorities = mutation({
  args: { scores: v.array(v.object({ householdId: v.id("households"), doorPriority: v.number() })) },
  returns: v.null(),
  handler: async (ctx, { scores }) => {
    for (const { householdId, doorPriority } of scores) await ctx.db.patch("households", householdId, { doorPriority });
    return null;
  },
});

// Field teams' order: unreached homes, highest score first. Falls back to need estimate before Track D writes.
export const queue = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const homes = await ctx.db
      .query("households")
      .withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", "door_check"))
      .take(1000);
    return homes
      .map((h) => ({ _id: h._id, address: h.address, lat: h.lat, lng: h.lng, priority: h.doorPriority ?? h.needProbability }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);
  },
});
