import { v } from "convex/values";
import { query, QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

// Events that come out of a call to a home: the activity list opens that call's transcript.
const CALL_KINDS: ReadonlySet<Doc<"events">["kind"]> = new Set(["call", "record", "retry"]);

// The call an event is about: the latest call at its home that had started by the time it happened.
async function callFor(ctx: QueryCtx, event: Doc<"events">) {
  const householdId = event.householdId;
  if (!householdId || !CALL_KINDS.has(event.kind)) return null;
  const call = await ctx.db
    .query("calls")
    .withIndex("by_householdId", (q) => q.eq("householdId", householdId))
    .order("desc")
    .filter((q) => q.lte(q.field("startedAt"), event.at))
    .first();
  return call?._id ?? null;
}

export const recent = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const events = await ctx.db.query("events").order("desc").take(limit);
    return await Promise.all(events.map(async (event) => ({ ...event, callId: await callFor(ctx, event) })));
  },
});
