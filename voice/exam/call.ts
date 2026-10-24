import { AgentTurn, Conversation, Escalation } from "../agent/conversation";
import type { AgentRecord } from "../agent/record";
import { Language, RequestStatus, RideStatus, statusLine } from "../agent/script";
import { pinnedStatus } from "../textAgent";
import type { ModuleId } from "./rubric";
import type { Check } from "./rubric";
import type { SourceId } from "./sources";

// One exam call: the real Conversation (state machine, honesty guard and Claude interpreter, as on a
// phone call) against a scripted caller. The caller answers whatever step the agent is on, so the
// script holds what a real caller said, not a guess at the order the agent asks in.

export type Step = Conversation["step"];

// A caller line. null is silence: the line goes quiet and the agent checks in.
export type Line =
  | string
  | null
  | {
      say: string;
      // The caller pushes for a ride or a promise here, so the status line must answer it.
      asksRide?: boolean;
      // The caller reports this here, so the escalation must be raised on this very turn.
      triggers?: Escalation;
    };

export type Script = Partial<Record<Step, Line[]>>;

// The ride status the agent sees: `status` from the start, then each change before the caller's
// n-th line on hold (0-based), the way a status change reaches a live call.
export type RideTimeline = { status: RequestStatus | null; changes?: { atHoldTurn: number; status: RequestStatus }[] };

export type ExamItem = {
  id: string;
  title: string;
  module: ModuleId;
  sources: SourceId[];
  // How the real call became this item.
  adapted: string;
  // Facts the source doesn't give, set so the item has one right answer.
  filled?: string;
  language: Language;
  knownAddress?: string;
  onFile?: AgentRecord;
  ride?: RideTimeline;
  caller: Script;
  // A short Prioritization item: stop after this many caller turns.
  stopAfter?: number;
  maxTurns?: number;
  expect: Expectation[];
};

export type Expectation = (call: CallOutcome) => Check[];

export type TurnKind = "opening" | "reply" | "announce" | "check_in";

export type AgentLine = {
  speaker: "agent";
  kind: TurnKind;
  // The caller turn this answers (0 for the opening).
  turn: number;
  parts: string[];
  text: string;
  step: Step;
  status: RequestStatus | "none";
  // What the agent would say about the ride right now, for checking ride questions.
  rideLine: string;
  ms?: number;
  ignored: boolean;
};

export type CallerLine = {
  speaker: "resident";
  turn: number;
  text: string | null;
  step: Step;
  asksRide: boolean;
  triggers?: Escalation;
};

export type EndedAs = "done" | "hold" | "lost_contact" | "handed_off" | "turn_limit" | "stopped";

export type CallOutcome = {
  item: ExamItem;
  run: number;
  lines: (AgentLine | CallerLine)[];
  record: AgentRecord;
  escalations: { kind: Escalation; turn: number }[];
  nominations: { address: string; turn: number }[];
  // The caller turn of the last record change (language switches aside).
  lastChangeTurn: number;
  endedAs: EndedAs;
  // Steps the agent reached that the script has no line for; the caller said "I'm not sure."
  unscripted: Step[];
  error?: string;
};

const DEFAULT_MAX_TURNS = 16;
const NOT_SURE = "I'm not sure.";

const ridesFor = (status: RequestStatus | null): RideStatus => (status ? pinnedStatus(status) : null);

class ExamCall {
  private readonly conversation: Conversation;
  private readonly outcome: CallOutcome;
  private ride: RideStatus;
  private turn = 0;
  private holdTurns = 0;
  private readonly asked = new Map<Step, number>();

  constructor(private readonly item: ExamItem, run: number) {
    this.ride = ridesFor(item.ride?.status ?? null);
    this.outcome = {
      item,
      run,
      lines: [],
      record: {},
      escalations: [],
      nominations: [],
      lastChangeTurn: 0,
      endedAs: "done",
      unscripted: [],
    };
    this.conversation = new Conversation({
      language: item.language,
      onFile: item.onFile ?? {},
      knownAddress: item.knownAddress,
      effects: {
        updateRecord: (patch) => this.recordChanged(patch),
        escalate: (kind) => this.outcome.escalations.push({ kind, turn: this.turn }),
        nominate: (address) => this.outcome.nominations.push({ address, turn: this.turn }),
        rideStatus: () => this.ride,
      },
    });
  }

  async run(): Promise<CallOutcome> {
    this.logAgent(this.conversation.start(), "opening");
    try {
      this.outcome.endedAs = await this.talk();
    } catch (error) {
      this.outcome.error = (error as Error).message;
    }
    this.outcome.record = this.conversation.record;
    return this.outcome;
  }

  private async talk(): Promise<EndedAs> {
    const maxTurns = this.item.maxTurns ?? DEFAULT_MAX_TURNS;
    while (!this.conversation.done) {
      if (this.item.stopAfter !== undefined && this.turn >= this.item.stopAfter) return "stopped";
      if (this.turn >= maxTurns) return "turn_limit";
      this.applyRideChange();
      const line = this.nextLine();
      if (line === undefined) return "hold";
      await this.callerSays(line);
    }
    return this.closedAs();
  }

  private closedAs(): EndedAs {
    if (this.conversation.lostContact) return "lost_contact";
    return this.outcome.escalations.some((raised) => raised.kind === "language_barrier") ? "handed_off" : "done";
  }

  // On hold the caller says each hold line once, then hangs up (undefined).
  private nextLine(): Line | undefined {
    const step = this.conversation.step;
    const lines = this.item.caller[step];
    const times = this.asked.get(step) ?? 0;
    this.asked.set(step, times + 1);
    if (step === "hold") return lines?.[times];
    if (!lines) {
      this.outcome.unscripted.push(step);
      return NOT_SURE;
    }
    return lines[Math.min(times, lines.length - 1)];
  }

  private async callerSays(line: Line) {
    this.turn += 1;
    const step = this.conversation.step;
    if (step === "hold") this.holdTurns += 1;
    const said = typeof line === "object" && line !== null ? line : { say: line };
    this.outcome.lines.push({
      speaker: "resident",
      turn: this.turn,
      text: said.say,
      step,
      asksRide: "asksRide" in said && said.asksRide === true,
      triggers: "triggers" in said ? said.triggers : undefined,
    });
    if (said.say === null) return this.logAgent(this.silence(), "check_in");
    const started = performance.now();
    const turn = await this.conversation.hear(said.say);
    this.logAgent(turn, "reply", Math.round(performance.now() - started));
  }

  private silence(): AgentTurn {
    return this.conversation.checkIn?.() ?? this.conversation.endHold();
  }

  private applyRideChange() {
    if (this.conversation.step !== "hold") return;
    const change = this.item.ride?.changes?.find((next) => next.atHoldTurn === this.holdTurns);
    if (!change || change.status === this.ride?.status) return;
    this.ride = ridesFor(change.status);
    const template = statusLine(this.ride, this.conversation.language);
    if (template) this.logAgent(this.conversation.announce(template), "announce");
  }

  private recordChanged(patch: AgentRecord & { language?: string }) {
    const fields = Object.keys(patch).filter((field) => field !== "language");
    if (fields.length > 0) this.outcome.lastChangeTurn = this.turn;
  }

  private logAgent(turn: AgentTurn, kind: TurnKind, ms?: number) {
    const parts = [turn.transfer?.line ?? "", turn.acknowledgment, ...turn.sentences].filter((part) => part !== "");
    this.outcome.lines.push({
      speaker: "agent",
      kind,
      turn: this.turn,
      parts,
      text: parts.join(" "),
      step: this.conversation.step,
      status: this.ride?.status ?? "none",
      rideLine: this.conversation.rideLine(),
      ms,
      ignored: turn.ignored,
    });
  }
}

export const runCall = (item: ExamItem, run: number) => new ExamCall(item, run).run();

export const agentLines = (call: CallOutcome) => call.lines.filter((line): line is AgentLine => line.speaker === "agent");
export const callerLines = (call: CallOutcome) => call.lines.filter((line): line is CallerLine => line.speaker === "resident");

// What the agent said back to caller turn n (the reply, plus any status announcement before it).
export const replyTo = (call: CallOutcome, turn: number) =>
  agentLines(call)
    .filter((line) => line.turn === turn && line.kind !== "announce")
    .map((line) => line.text)
    .join(" ");
