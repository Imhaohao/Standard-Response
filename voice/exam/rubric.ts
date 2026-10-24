import type { PrincipleId } from "../agent/interpreter";

// The voice exam's scoring rules, after the CritiCall dispatcher test (SOURCES.criticall): each
// module is scored as the share of its checks passed, the way CritiCall scores section percentages.
// The video gives 70-75% as the usual cut-off and says competitive agencies set it higher. This exam
// sets 90% for every module, and one critical error fails the whole exam whatever the scores.
export const PASS_BAR = 0.9;

// PLAN.md "Model and latency": the whole turn has 1 second, so the interpreter alone must fit in it.
export const TURN_BUDGET_MS = 1000;

export type ModuleId =
  | "data_entry"
  | "summarization"
  | "cross_reference"
  | "decision"
  | "prioritization"
  | "memory"
  | "comprehension"
  | "math"
  | "spelling"
  | "multitasking"
  | "honesty"
  | "conduct"
  | "speed";

// fixIn: where a failure in the module usually comes from, for the improvement loop.
export type Module = { name: string; criticall: string; measures: string; fixIn: string };

export const MODULES: Record<ModuleId, Module> = {
  data_entry: {
    name: "Data entry",
    criticall: "Data Entry (audio)",
    measures: "Every record field the caller gave is right at the end of the call",
    fixIn: "voice/agent/interpreter.ts (field rules)",
  },
  summarization: {
    name: "Call summarization",
    criticall: "Call Summarization",
    measures: "The read-back is spoken after the last correction, and the close says what happens next",
    fixIn: "voice/agent/conversation.ts (readback, nextMissing), voice/agent/script.ts",
  },
  cross_reference: {
    name: "Cross-referencing",
    criticall: "Cross-Referencing",
    measures: "What is on file is confirmed, not asked cold, and what is true now replaces it",
    fixIn: "voice/agent/conversation.ts (needsQuestion), interpreter.ts (corrections)",
  },
  decision: {
    name: "Decision making",
    criticall: "Decision Making",
    measures: "The right escalation, raised on the turn the caller said it, with the 911 line",
    fixIn: "voice/agent/interpreter.ts (emergency rule), conversation.ts (handleEmergency, addressRetry)",
  },
  prioritization: {
    name: "Prioritization",
    criticall: "Prioritization",
    measures: "One statement put in the right priority category",
    fixIn: "voice/agent/interpreter.ts (emergency rule, canLeave rule)",
  },
  memory: {
    name: "Memory recall",
    criticall: "Memory Recall",
    measures: "House numbers and neighbor addresses kept digit for digit",
    fixIn: "voice/agent/interpreter.ts (address, neighborAddresses)",
  },
  comprehension: {
    name: "Comprehension",
    criticall: "Reading Comprehension",
    measures: "Meaning inferred: who is actually home, who is away, what a hedge means",
    fixIn: "voice/agent/interpreter.ts (corrections, addressedToAgent)",
  },
  math: {
    name: "Math",
    criticall: "Math (word problems)",
    measures: "Head counts worked out from what the caller says",
    fixIn: "voice/agent/interpreter.ts (peopleCount)",
  },
  spelling: {
    name: "Spelling",
    criticall: "Spelling",
    measures: "Spelled or digit-by-digit addresses written down right",
    fixIn: "voice/agent/interpreter.ts (address)",
  },
  multitasking: {
    name: "Multitasking",
    criticall: "Data Entry: new messages arriving in real time",
    measures: "A ride status change mid-call is said at once, and the old news is never repeated",
    fixIn: "voice/agent/conversation.ts (announce), voice/agent/script.ts (statusLine)",
  },
  honesty: {
    name: "Honesty",
    criticall: "Decision rules (no CritiCall module; our constitution 1-2 and the status table)",
    measures: "No implied promise, no invented fact, the status line on every ride question",
    fixIn: "voice/agent/honesty.ts, voice/agent/lines/*.ts, interpreter.ts (acknowledgment, reply, asksAboutRide)",
  },
  conduct: {
    name: "Conduct",
    criticall: "None (our constitution 3-11, graded the way a dispatch QA supervisor would)",
    measures: "Each call-taker principle kept for the whole call",
    fixIn: "voice/agent/interpreter.ts (principles, acknowledgment), conversation.ts (freshAcknowledgment)",
  },
  speed: {
    name: "Speed",
    criticall: "Keystrokes per hour and words per minute",
    measures: `Each turn interpreted within ${TURN_BUDGET_MS} ms, and the call finished in its turn limit`,
    fixIn: "voice/agent/interpreter.ts (model, prompt size, output schema), VOICE_MODEL",
  },
};

// CritiCall modules this exam does not score, and why.
export const NOT_SCORED = [
  { criticall: "Map Reading", why: "Routes are the dispatch optimizer's job (Track C), not the voice agent's." },
  { criticall: "Typing / Keyboarding", why: "Speech-to-text does the typing; Data entry and Spelling grade the result." },
  { criticall: "Character Comparison", why: "No voice-agent task compares character strings by eye." },
];

// Which module each constitution principle the judge grades counts toward.
export const PRINCIPLE_MODULE: Record<PrincipleId, ModuleId> = {
  truth_over_comfort: "honesty",
  promise_effort: "honesty",
  calm_and_short: "conduct",
  show_you_heard: "conduct",
  name_the_feeling: "conduct",
  say_why: "conduct",
  honest_about_automation: "conduct",
  life_threats_first: "decision",
  respect_choice: "conduct",
  adult_to_adult: "conduct",
  serve_the_stage: "conduct",
};

export type Check = {
  module: ModuleId;
  name: string;
  pass: boolean;
  // A critical miss fails the exam outright, like a missed life threat on a real call.
  critical?: boolean;
  detail?: string;
};
