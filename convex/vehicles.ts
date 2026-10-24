import { v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { seedFleetIfEmpty } from "./seed";

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

// A deployment with a real rider list but no fleet yet (riders imported before the warning).
export const ensureFleet = mutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await seedFleetIfEmpty(ctx, Date.now()),
});
