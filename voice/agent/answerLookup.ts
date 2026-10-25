import type { DocumentInfo, MossClient } from "@inferedge/moss";
import { env } from "../env";
import { loadMossIndex, MOSS_RETRY_MS, sharedMossClient } from "../mossLoader";
import { APPROVED_ANSWER_IDS, APPROVED_ANSWERS, ApprovedMatch, isApprovedAnswerId } from "./approvedAnswers";

// Moss holds the approved-answer index in this process's memory, so a lookup takes 1 to 2 ms with
// no network call. It searches Claude's English restatement of the resident's question rather than
// their words: Moss's default embedding model reads English, and Spanish questions matched the wrong
// answer with full confidence. Without Moss keys, every lookup is a miss and Claude's reply stands.

export const APPROVED_ANSWER_INDEX = "approved-answers";

let client: MossClient | null = null;
let ready = false;

// Each phrasing of each question is one document; its metadata names the answer it leads to.
export function approvedAnswerDocuments(): DocumentInfo[] {
  return APPROVED_ANSWER_IDS.flatMap((id) =>
    APPROVED_ANSWERS[id].questions.map((text, index) => ({ id: `${id}.${index}`, text, metadata: { answer: id } })),
  );
}

export const mossClient = sharedMossClient;

// Called once at boot. Loading downloads the index and its embedding model, which takes about 12
// seconds; calls that start before then simply get Claude's reply.
export async function loadApprovedAnswers() {
  const moss = mossClient();
  if (!moss) {
    console.log("[moss] MOSS_PROJECT_ID or MOSS_PROJECT_KEY not set; approved answers are off");
    return;
  }
  try {
    await loadMossIndex(APPROVED_ANSWER_INDEX);
    client = moss;
    ready = true;
    console.log(`[moss] loaded ${APPROVED_ANSWER_INDEX}`);
  } catch (error) {
    console.error("[moss] couldn't load the approved answers; trying again in a minute", error);
    setTimeout(() => void loadApprovedAnswers(), MOSS_RETRY_MS);
  }
}

export async function findApprovedAnswer(question: string): Promise<ApprovedMatch | null> {
  if (!ready || !client || question.trim() === "") return null;
  const started = performance.now();
  try {
    const result = await client.query(APPROVED_ANSWER_INDEX, question, { topK: 1 });
    const best = result.docs.at(0);
    const id = best?.metadata?.answer;
    if (!best || best.score < env.moss.answerMinScore || !isApprovedAnswerId(id)) return null;
    const match = { id, score: best.score, lookupMs: Math.round(performance.now() - started) };
    console.log(`[moss] "${question}" -> ${id} (score ${best.score.toFixed(2)}, ${match.lookupMs} ms)`);
    return match;
  } catch (error) {
    console.error("[moss] lookup failed", error);
    return null;
  }
}
