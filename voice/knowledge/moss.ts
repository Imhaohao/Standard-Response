import { MossClient, type MetadataFilter, type QueryResultDocumentInfo } from "@inferedge/moss";
import type { Hazard } from "../../convex/hazards";
import type { Language } from "../../convex/languages";
import { env } from "../env";
import { Guidance, INDEXES, momentText } from "./bank";

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
const CACHE_PATH = process.env.MOSS_CACHE_PATH || ".cache/moss";

let client: MossClient | null = null;
let loading: Promise<boolean> | null = null;
let ready = false;

export const knowledgeConfigured = () => env.moss.enabled && env.moss.projectId !== "" && env.moss.projectKey !== "";

export function loadKnowledge(): Promise<boolean> {
  if (!knowledgeConfigured()) return Promise.resolve(false);
  loading ??= (async () => {
    client = new MossClient(env.moss.projectId, env.moss.projectKey);
    const started = Date.now();
    await Promise.all(Object.values(INDEXES).map((name) => client!.loadIndex(name, { cachePath: CACHE_PATH })));
    ready = true;
    console.log(`[knowledge] Moss indexes loaded in ${Date.now() - started} ms`);
    return true;
  })().catch((error: unknown) => {
    console.error("[knowledge] Moss indexes failed to load; turns run without guidance", error);
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

const dialogFilter = (kind: Hazard, language: Language): MetadataFilter => {
  const sameHazard: MetadataFilter = { field: "hazard", condition: { $eq: kind } };
  if (!BANK_LANGUAGES.includes(language)) return sameHazard;
  return { $and: [sameHazard, { field: "language", condition: { $eq: language } }] };
};

const relevant = (docs: QueryResultDocumentInfo[]) => docs.filter((doc) => doc.score >= MIN_SCORE);

async function search(question: string, utterance: string, kind: Hazard, language: Language): Promise<Guidance> {
  const [principles, moments] = await Promise.all([
    client!.query(INDEXES.principles, utterance, { topK: PRINCIPLES_PER_TURN, filter: hazardFilter(kind) }),
    client!.query(INDEXES.dialogs, momentText(question, utterance), { topK: MOMENTS_PER_TURN, filter: dialogFilter(kind, language) }),
  ]);
  return {
    principles: relevant(principles.docs).map((doc) => ({
      principle: doc.metadata?.principle ?? "",
      situation: doc.metadata?.situation ?? doc.text,
      guidance: doc.metadata?.guidance ?? "",
    })),
    moments: relevant(moments.docs).map((doc) => ({ text: doc.text, reading: doc.metadata?.reading ?? "" })),
  };
}

const timeout = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

// The principles and past moments closest to what the resident just said, or null when the layer is
// off, still loading, failing or too slow.
export async function recall(question: string, utterance: string, kind: Hazard, language: Language): Promise<Guidance | null> {
  if (!ready) {
    void loadKnowledge();
    return null;
  }
  const started = Date.now();
  const found = await Promise.race([
    search(question, utterance, kind, language).catch((error: unknown) => {
      console.error("[knowledge] Moss query failed", error);
      return null;
    }),
    timeout(RECALL_BUDGET_MS),
  ]);
  if (found) console.log(`[knowledge] recall ${Date.now() - started} ms: ${found.principles.length} principles, ${found.moments.length} moments`);
  return found;
}
