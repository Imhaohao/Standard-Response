import type { DocumentInfo } from "@inferedge/moss";
import type { Hazard } from "../../convex/hazards";
import type { Language } from "../../convex/languages";
import type { PrincipleId } from "../agent/interpreter";

// Two Moss indexes sit in front of the interpreter. The principles index holds the constitution
// (CALL_TAKER_PRINCIPLES) worked out into concrete situations; the dialog index holds every resident
// turn of the 911 dialog bank with the reading a careful call-taker gave it. Each turn, the resident's
// words pull the closest few of each into Claude's prompt.

export const INDEXES = { principles: "rollcall-principles", dialogs: "rollcall-911-dialogs" } as const;

export const BANK_FILES = {
  principles: "data/moss/principles.jsonl",
  scripts: "data/moss/dialog-bank.jsonl",
} as const;

// Steps of voice/agent/conversation.ts a scripted resident turn can answer.
export const SCRIPT_STEPS = [
  "ask_address",
  "confirm_address",
  "can_leave",
  "has_car",
  "household",
  "needs",
  "assistance",
  "readback",
  "fix",
  "neighbor",
  "hold",
] as const;
export type ScriptStep = (typeof SCRIPT_STEPS)[number];

export type PrincipleCard = {
  id: string;
  principle: PrincipleId;
  hazard: Hazard | "any";
  situation: string;
  // One document per language, so a Spanish caller's words find the card as well.
  callerSays: { en: string; es: string };
  guidance: string;
  exampleLine: string;
};

// The interpreter's wire format (OUTPUT_SCHEMA in voice/agent/interpreter.ts): only set is required.
export type Reading = {
  set: string[];
  guessed?: string[];
  answer?: string;
  emergency?: string;
  flags?: string[];
  neighbors?: string[];
  language?: string;
  feeling?: string;
  ack?: string;
  reply?: string;
};

// checked: both readers agreed on what the turn means (voice/knowledge/checker.ts). Only checked
// turns are indexed; the rest stay so each script reads as the whole call.
export type ScriptTurn = { step: ScriptStep; agent: string; resident: string; reading: Reading; checked?: boolean };

export type Script = {
  id: string;
  hazard: Hazard;
  language: Language;
  persona: string;
  twists: string[];
  // Which real call (spikecodes/911-call-transcripts) lent the caller's voice.
  seedCall: number;
  turns: ScriptTurn[];
};

// What a moment looks like to the embedding model, the same on both sides of the search.
export const momentText = (agent: string, resident: string) => `Agent: ${agent}\nResident: ${resident}`;

export const principleDocs = (card: PrincipleCard): DocumentInfo[] =>
  (["en", "es"] as const).map((language) => ({
    id: `${card.id}-${language}`,
    text: card.callerSays[language] ? `${card.situation} Caller: "${card.callerSays[language]}"` : card.situation,
    metadata: { principle: card.principle, hazard: card.hazard, situation: card.situation, guidance: card.guidance },
  }));

export const dialogDocs = (script: Script): DocumentInfo[] =>
  script.turns.flatMap((turn, index) => (turn.checked ? [{
    id: `${script.id}-${index}`,
    text: momentText(turn.agent, turn.resident),
    metadata: {
      hazard: script.hazard,
      language: script.language,
      step: turn.step,
      reading: JSON.stringify(turn.reading),
    },
  }] : []));

export type Guidance = {
  principles: { principle: string; situation: string; guidance: string }[];
  moments: { text: string; reading: string }[];
};

// Rendered into the interpreter's per-turn prompt, after the cached system prompt.
export function guidanceText(guidance: Guidance | null): string {
  if (!guidance) return "";
  const principles = guidance.principles.map((card) =>
    card.situation === card.guidance ? `- ${card.principle}: ${card.guidance}` : `- ${card.principle}: ${card.situation} ${card.guidance}`,
  );
  const moments = guidance.moments.map((moment) => `${moment.text}\nReading: ${moment.reading}`);
  return [
    principles.length ? `Principles that fit this moment:\n${principles.join("\n")}` : "",
    moments.length
      ? `Similar moments from the 911 dialog bank, with the reading a careful call-taker gave. They are other callers: read only what this resident said. They show how to read answers to the agent's questions, and none of those callers asked one of their own, so a field a reading leaves out says nothing about this resident: set policy_question from this resident's words alone.\n${moments.join("\n\n")}`
      : "",
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}
