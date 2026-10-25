import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { householdSource } from "./elasticDocs";

const BACKFILL_PAGE = 200;

const householdSourceShape = v.object({
  householdId: v.string(),
  address: v.string(),
  language: v.string(),
  summary: v.string(),
});

const lineSourceShape = v.object({
  lineId: v.string(),
  householdId: v.string(),
  callId: v.string(),
  address: v.string(),
  language: v.string(),
  speaker: v.union(v.literal("agent"), v.literal("resident")),
  text: v.string(),
  at: v.number(),
});

// One transcript line with the home it belongs to, in the shape the search index stores.
export const lineForIndex = internalQuery({
  args: { lineId: v.id("transcriptLines") },
  returns: v.union(v.null(), v.object({ line: lineSourceShape, household: householdSourceShape })),
  handler: async (ctx, { lineId }) => {
    const line = await ctx.db.get("transcriptLines", lineId);
    const call = line && (await ctx.db.get("calls", line.callId));
    const household = call && (await ctx.db.get("households", call.householdId));
    if (!line || !household) return null;
    const source = { lineId: line._id, householdId: household._id, callId: line.callId, address: household.address, language: household.language };
    return { line: { ...source, speaker: line.speaker, text: line.text, at: line.at }, household: householdSource(household) };
  },
});

export const householdForIndex = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.union(v.null(), householdSourceShape),
  handler: async (ctx, { householdId }) => {
    const household = await ctx.db.get("households", householdId);
    return household && householdSource(household);
  },
});

export const householdPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ homes: v.array(householdSourceShape), next: v.union(v.string(), v.null()) }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("households").paginate({ cursor, numItems: BACKFILL_PAGE });
    return { homes: page.page.map(householdSource), next: page.isDone ? null : page.continueCursor };
  },
});
