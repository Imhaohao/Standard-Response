import { v } from "convex/values";
import { MutationCtx, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { mutation } from "./functions";
import { closureSource, point } from "./schema";
import { simNow } from "./clock";
import type { Point } from "./model";

export const closures = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("roadClosures").take(1000),
});

type ClosureInput = {
  edgeKey?: string;
  // Set when the closure arrives already snapped (Apify), so the dispatcher's snap leaves it alone.
  edgeKeys?: string[];
  streets?: string[];
  path: Point[];
  source: Doc<"roadClosures">["source"];
  sourceKey?: string;
  confirmed?: boolean;
};

async function alreadyClosed(ctx: MutationCtx, closure: ClosureInput) {
  const { edgeKey, sourceKey } = closure;
  if (sourceKey !== undefined) {
    const same = await ctx.db.query("roadClosures").withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey)).first();
    if (same) return true;
  }
  if (edgeKey === undefined) return false;
  return (await ctx.db.query("roadClosures").withIndex("by_edgeKey", (q) => q.eq("edgeKey", edgeKey)).first()) !== null;
}

// Every closure goes in through here. A closure whose edgeKey or sourceKey already exists is ignored.
export async function insertClosures(ctx: MutationCtx, closures: ClosureInput[]) {
  let added = 0;
  const at = await simNow(ctx);
  for (const closure of closures) {
    if (await alreadyClosed(ctx, closure)) continue;
    const confirmed = closure.confirmed ?? closure.source !== "resident";
    await ctx.db.insert("roadClosures", { ...closure, confirmed, at });
    added += 1;
  }
  return added;
}

// Hazard (Track D), driver and resident reports (Track C, Track B), and the manual demo control (Track A).
// Apify closures arrive through convex/http.ts.
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
  handler: async (ctx, { closures }) => await insertClosures(ctx, closures),
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
