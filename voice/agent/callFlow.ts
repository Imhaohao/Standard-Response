import type { AgentTurn } from "./conversation";
import type { Language } from "./script";

// What a live phone call drives: the evening survey (Conversation), the pickup check (PlanCheck) and
// the Ready check (ReadyCall) all listen, take a turn and speak through this same surface.
export interface CallFlow {
  readonly language: Language;
  readonly done: boolean;
  // Waiting on the line for a driver. Only the evening survey holds.
  readonly holding: boolean;
  start(): AgentTurn;
  hear(utterance: string): Promise<AgentTurn>;
  question(): string;
  endHold(): AgentTurn;
  announce(template: string): AgentTurn;
  // Said instead of the conversation when an answering machine picks up.
  voicemail?(): string[];
  // The resident was on the line and the call ended, finished or not: flush what the call learned.
  lineClosed?(): void;
}

export const silentTurn = (flow: { done: boolean }, stage: AgentTurn["stage"]): AgentTurn => ({
  acknowledgment: "",
  sentences: [],
  stage,
  done: flow.done,
  guardBlocked: false,
  ignored: true,
});
