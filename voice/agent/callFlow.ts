import type { AgentTurn, Rehear } from "./conversation";
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
  // hear() in two halves: read() interprets without changing anything, and the function it returns
  // acts on that reading. A call throws the reading away and reads again when the resident turns
  // out to still be talking. After the closing line, the reading is all the flow still listens to.
  // rehear transcribes the turn again in other languages, on lines that carry the call audio.
  read(utterance: string, rehear?: Rehear): Promise<() => AgentTurn>;
  // The line went quiet after a question: check in. The voice eval still uses it; live calls don't
  // speak on a quiet line and call lineWentQuiet instead.
  checkIn?(): AgentTurn;
  // The line stayed quiet so long that the call ends without a word: settle what that means.
  lineWentQuiet?(): void;
  // The call ended on check-ins nobody answered, so it doesn't count as answered.
  readonly lostContact?: boolean;
  question(): string;
  endHold(): AgentTurn;
  announce(template: string): AgentTurn;
  // Said instead of the conversation when an answering machine picks up.
  voicemail?(): string[];
  // The resident was on the line and the call ended, finished or not: flush what the call learned.
  lineClosed?(): void;
  // Once the flow is done: put the caller through to this number instead of hanging up.
  readonly connectTo?: string | null;
}

export const silentTurn = (flow: { done: boolean }, stage: AgentTurn["stage"]): AgentTurn => ({
  acknowledgment: "",
  sentences: [],
  stage,
  done: flow.done,
  guardBlocked: false,
  ignored: true,
});
