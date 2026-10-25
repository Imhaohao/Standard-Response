import { WithoutSystemFields } from "convex/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";

// Every transcript line is inserted through here, so the search index hears about it. The index
// call is a no-op until ELASTIC_URL and ELASTIC_API_KEY are set (convex/elastic.ts).
export async function insertTranscriptLine(ctx: MutationCtx, line: WithoutSystemFields<Doc<"transcriptLines">>): Promise<Id<"transcriptLines">> {
  const lineId = await ctx.db.insert("transcriptLines", line);
  await ctx.scheduler.runAfter(0, internal.elastic.indexLine, { lineId });
  return lineId;
}
