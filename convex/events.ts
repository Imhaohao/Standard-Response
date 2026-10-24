import { v } from "convex/values";
import { query } from "./_generated/server";

export const recent = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    return await ctx.db.query("events").order("desc").take(limit);
  },
});
