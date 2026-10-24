import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("vehicles").take(200),
});

export const shelters = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("shelters").take(50),
});

// Track C's vehicle simulation, or the driver page's location.
export const setPositions = mutation({
  args: { positions: v.array(v.object({ vehicleId: v.id("vehicles"), lat: v.number(), lng: v.number() })) },
  returns: v.null(),
  handler: async (ctx, { positions }) => {
    for (const { vehicleId, lat, lng } of positions) await ctx.db.patch("vehicles", vehicleId, { lat, lng });
    return null;
  },
});
