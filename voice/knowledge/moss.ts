import type { MossClient, MetadataFilter, QueryResultDocumentInfo } from "@inferedge/moss";
import type { Hazard } from "../../convex/hazards";
import type { Language } from "../../convex/languages";
import { env } from "../env";
import { loadMossIndex, MOSS_RETRY_MS, mossConfigured, sharedMossClient } from "../mossLoader";
import { Guidance, INDEXES, momentText, scriptStepOf } from "./bank";

// The first layer of every interpreter turn. Both indexes are downloaded once and searched in memory
// (Moss embeds the query locally), so a lookup costs milliseconds and no network. A turn never waits
// for the download or for a slow search: until the indexes are ready, or past the budget, Claude
// reads the turn without guidance.

const PRINCIPLES_PER_TURN = 2;
const MOMENTS_PER_TURN = 3;
const RECALL_BUDGET_MS = 80;
// Below this the match is about something else, and an off-topic example misleads more than none.
const MIN_SCORE = 0.35;
// The dialog bank is written in these; elsewhere the closest moments in any language are used.
const BANK_LANGUAGES: readonly Language[] = ["en", "es"];

let client: MossClient | null = null;
let loading: Promise<boolean> | null = null;
let ready = false;

export const knowledgeConfigured = () => env.moss.enabled && mossConfigured();

export function loadKnowledge(): Promise<boolean> {
  if (!knowledgeConfigured()) return Promise.resolve(false);
  loading ??= (async () => {
    const started = Date.now();
    for (const name of Object.values(INDEXES)) await loadMossIndex(name);
    client = sharedMossClient();
    ready = true;
    console.log(`[knowledge] Moss indexes loaded in ${Date.now() - started} ms`);
    return true;
  })().catch((error: unknown) => {
    console.error("[knowledge] Moss indexes failed to load; turns run without guidance", error);
    setTimeout(() => (loading = null), MOSS_RETRY_MS);
    return false;
  });
  return loading;
}

const hazardFilter = (kind: Hazard): MetadataFilter => ({
  $or: [
    { field: "hazard", condition: { $eq: kind } },
    { field: "hazard", condition: { $eq: "any" } },
  ],
});

// What a turn needs to search: the resident's words, the step they answer and the call's language.
export type RecallTurn = { utterance: string; stage: string; language: Language };

const dialogFilter = (kind: Hazard, turn: RecallTurn): MetadataFilter => {
  const step = scriptStepOf(turn.stage);
  const conditions: MetadataFilter[] = [
    { field: "hazard", condition: { $eq: kind } },
    ...(step ? [{ field: "step", condition: { $eq: step } }] : []),
    ...(BANK_LANGUAGES.includes(turn.language) ? [{ field: "language", condition: { $eq: turn.language } }] : []),
  ];
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

const relevant = (docs: QueryResultDocumentInfo[]) => docs.filter((doc) => doc.score >= MIN_SCORE);

async function search(turn: RecallTurn, kind: Hazard): Promise<Guidance> {
  const [principles, moments] = await Promise.all([
    client!.query(INDEXES.principles, turn.utterance, { topK: PRINCIPLES_PER_TURN, filter: hazardFilter(kind) }),
    client!.query(INDEXES.dialogs, turn.utterance, { topK: MOMENTS_PER_TURN, filter: dialogFilter(kind, turn) }),
  ]);
  return {
    principles: relevant(principles.docs).map((doc) => ({
      principle: doc.metadata?.principle ?? "",
      situation: doc.metadata?.situation ?? doc.text,
      guidance: doc.metadata?.guidance ?? "",
    })),
    moments: relevant(moments.docs).map((doc) => ({ text: momentText(doc.metadata?.agent ?? "", doc.text), reading: doc.metadata?.reading ?? "" })),
  };
}

const timeout = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

// The principles and past moments closest to what the resident just said, or null when the layer is
// off, still loading, failing or too slow.
export async function recall(turn: RecallTurn, kind: Hazard): Promise<Guidance | null> {
  if (!ready) {
    void loadKnowledge();
    return null;
  }
  const started = Date.now();
  const found = await Promise.race([
    search(turn, kind).catch((error: unknown) => {
      console.error("[knowledge] Moss query failed", error);
      return null;
    }),
    timeout(RECALL_BUDGET_MS),
  ]);
  if (found) console.log(`[knowledge] recall ${Date.now() - started} ms: ${found.principles.length} principles, ${found.moments.length} moments`);
  return found;
}
