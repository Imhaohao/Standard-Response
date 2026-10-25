import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { resolvedStatusFor, toDoorCheckItem } from "./doorCheckPayload";
import { mutation } from "./functions";

// The door-check score. Send any subset of households, as often as you like.
export const setPriorities = mutation({
  args: { scores: v.array(v.object({ householdId: v.id("households"), doorPriority: v.number() })) },
  returns: v.null(),
  handler: async (ctx, { scores }) => {
    for (const { householdId, doorPriority } of scores) await ctx.db.patch("households", householdId, { doorPriority });
    return null;
  },
});

async function rankedDoorChecks(ctx: QueryCtx, limit: number) {
  const homes = await ctx.db
    .query("households")
    .withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", "door_check"))
    .take(1000);
  return homes
    .map((home) => ({ home, priority: home.doorPriority ?? home.needProbability }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

// Field teams' order: unreached homes, highest score first. Falls back to need estimate before the model runner writes.
export const queue = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const ranked = await rankedDoorChecks(ctx, limit);
    return ranked.map(({ home, priority }) => ({ _id: home._id, address: home.address, lat: home.lat, lng: home.lng, priority }));
  },
});

// The Atlassian Forge app's view (convex/http.ts, POST /agent/door-checks): the same order as `queue`,
// cut down to what a crew needs, plus where the homes it already has issues for now stand.
export const forFieldCrews = internalQuery({
  args: { limit: v.number(), reportOn: v.array(v.string()) },
  handler: async (ctx, { limit, reportOn }) => {
    const ranked = await rankedDoorChecks(ctx, limit);
    const queue = ranked.map(({ home }, index) => toDoorCheckItem(home, index + 1));
    const queued = new Set(queue.map((item) => item.householdId));
    const resolved = [];
    for (const id of reportOn.filter((reported) => !queued.has(reported))) {
      const householdId = ctx.db.normalizeId("households", id);
      const home = householdId ? await ctx.db.get("households", householdId) : null;
      resolved.push({ householdId: id, status: resolvedStatusFor(home) });
    }
    return { queue, resolved };
  },
});
