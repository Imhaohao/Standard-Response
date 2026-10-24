import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { closureSource, point } from "./schema";

export const closures = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("roadClosures").take(1000),
});

// Hazard (Track D), driver and resident reports (Track C, Track B), and the manual demo control (Track A).
// A closure with an edgeKey that already exists is ignored.
export const addClosures = mutation({
  args: {
    closures: v.array(
      v.object({
        edgeKey: v.optional(v.string()),
        path: v.array(point),
        source: closureSource,
        confirmed: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { closures }) => {
    let added = 0;
    for (const closure of closures) {
      const edgeKey = closure.edgeKey;
      const existing =
        edgeKey !== undefined
          ? await ctx.db.query("roadClosures").withIndex("by_edgeKey", (q) => q.eq("edgeKey", edgeKey)).first()
          : null;
      if (existing) continue;
      const confirmed = closure.confirmed ?? closure.source !== "resident";
      await ctx.db.insert("roadClosures", { ...closure, confirmed, at: Date.now() });
      added += 1;
    }
    return added;
  },
});

// Track C snaps a drawn closure to the road graph.
export const setEdgeKey = mutation({
  args: { closureId: v.id("roadClosures"), edgeKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { closureId, edgeKey }) => {
    await ctx.db.patch("roadClosures", closureId, { edgeKey });
    return null;
  },
});
