"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ElasticLike, forgetHouseholds, indexDocuments, searchIndex } from "./elasticCore";
import { householdDocument, lineDocument } from "./elasticDocs";

// Search over call transcripts and households, kept in Elastic Cloud. Set ELASTIC_URL and
// ELASTIC_API_KEY in the Convex env. With either unset every function here logs and does nothing,
// and `search` returns no results.

async function connect(): Promise<ElasticLike | null> {
  const { ELASTIC_URL, ELASTIC_API_KEY } = process.env;
  if (!ELASTIC_URL || !ELASTIC_API_KEY) {
    console.log("elastic: ELASTIC_URL or ELASTIC_API_KEY is not set, skipping");
    return null;
  }
  const { Client } = await import("@elastic/elasticsearch");
  return new Client({ node: ELASTIC_URL, auth: { apiKey: ELASTIC_API_KEY }, serverMode: "serverless" }) as unknown as ElasticLike;
}

export const forgetHomes = internalAction({
  args: { householdIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (_ctx, { householdIds }) => {
    const client = await connect();
    if (client) await forgetHouseholds(client, householdIds);
    return null;
  },
});

export const indexLine = internalAction({
  args: { lineId: v.id("transcriptLines") },
  returns: v.null(),
  handler: async (ctx, { lineId }) => {
    const client = await connect();
    if (!client) return null;
    const found = await ctx.runQuery(internal.elasticData.lineForIndex, { lineId });
    if (!found) return null;
    await indexDocuments(client, [lineDocument(found.line), householdDocument(found.household)]);
    return null;
  },
});

export const indexHousehold = internalAction({
  args: { householdId: v.id("households") },
  returns: v.null(),
  handler: async (ctx, { householdId }) => {
    const client = await connect();
    if (!client) return null;
    const household = await ctx.runQuery(internal.elasticData.householdForIndex, { householdId });
    if (household) await indexDocuments(client, [householdDocument(household)]);
    return null;
  },
});

// Indexes every household, 200 at a time, each page scheduling the next. Run once after turning Elastic on:
// `npx convex run elastic:backfill`. Lines are indexed as they are spoken; lines said earlier stay out.
export const backfill = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const client = await connect();
    if (!client) return null;
    const { homes, next } = await ctx.runQuery(internal.elasticData.householdPage, { cursor: cursor ?? null });
    await indexDocuments(client, homes.map(householdDocument));
    if (next !== null) await ctx.scheduler.runAfter(0, internal.elastic.backfill, { cursor: next });
    return null;
  },
});

const searchResult = v.object({
  householdId: v.string(),
  address: v.string(),
  snippet: v.string(),
  callId: v.optional(v.string()),
  at: v.optional(v.number()),
});

// Public like households.coverage: nothing in Convex checks who is calling. The call floor page is
// dispatcher-only, but this endpoint is not gated server-side yet.
export const search = action({
  args: { q: v.string(), language: v.optional(v.string()) },
  returns: v.array(searchResult),
  handler: async (_ctx, { q, language }) => {
    const query = q.trim();
    if (query === "") return [];
    const client = await connect();
    return client ? await searchIndex(client, query, language) : [];
  },
});
