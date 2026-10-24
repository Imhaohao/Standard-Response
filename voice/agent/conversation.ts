import type { Doc } from "../../convex/_generated/dataModel";
import { guardAcknowledgment } from "./honesty";
import { canSpeak, Emergency, interpret, Interpretation, TurnContext } from "./interpreter";
import { AgentRecord, changedFields, Confidence, hasLimitedMobility, isEmpty, needsRide } from "./record";
import { Language, LINES, readback, RideStatus, statusLine, withSafety } from "./script";

// The deterministic half of the agent. It decides what to ask next and what may be said about a
// ride. Claude (interpreter.ts) only reads the resident's words and writes a short acknowledgment.
// Phone calls and the text endpoint (POST /turn) run this same class.

export type Stage = Doc<"calls">["stage"];
export type Escalation = Exclude<Emergency, "none"> | "address_unconfirmed" | "language_barrier";

type Step =
  | "ask_address"
  | "confirm_address"
  | "can_leave"
  | "has_car"
  | "household"
  | "needs"
  | "assistance"
  | "readback"
  | "fix"
  | "neighbor"
  | "done";

const STAGE_OF: Record<Step, Stage> = {
  ask_address: "confirm_address",
  confirm_address: "confirm_address",
  can_leave: "can_leave",
  has_car: "can_leave",
  household: "household",
  needs: "needs",
  assistance: "needs",
  readback: "readback",
  fix: "readback",
  neighbor: "close",
  done: "close",
};

// What the conversation does to the world. The phone call writes to Convex; the eval endpoint doesn't.
export interface ConversationEffects {
  updateRecord(patch: AgentRecord & { language?: string }, confidence: Confidence): void;
  escalate(kind: Escalation): void;
  nominate(spokenAddress: string): void;
  rideStatus(): RideStatus;
}

export type AgentTurn = {
  // Claude's short acknowledgment, already through the honesty guard. The phone call drops it
  // when a backchannel already covered the wait.
  acknowledgment: string;
  sentences: string[];
  stage: Stage;
  done: boolean;
  guardBlocked: boolean;
  // Background noise or talk not meant for the agent: nothing was said back and nothing changed.
  ignored: boolean;
  // Set when the resident switched language: said in the old language and voice before a pause.
  transfer?: { line: string; language: Language };
};

export type ConversationOptions = {
  language: Language;
  // What the agency already has on file. The agent confirms these rather than asking from scratch.
  onFile: AgentRecord;
  knownAddress?: string;
  residentName?: string;
  effects: ConversationEffects;
};

const MAX_TRIES_PER_STEP = 2;

const hasHouseNumber = (address: string | undefined) => address !== undefined && /\d/.test(address);
const MAX_READBACKS = 3;
// Turns in a row where nothing usable was heard before the call goes to a person.
const MAX_MISSED_TURNS = 3;
const MAX_UNKNOWN_LANGUAGE_TURNS = 2;
const HISTORY_TURNS = 6;

type Transition = { step: Step; lines?: string[] };

export class Conversation {
  language: Language;
  record: AgentRecord;
  step: Step;
  private readonly effects: ConversationEffects;
  private readonly knownAddress?: string;
  private readonly residentName?: string;
  private triesOnStep = 0;
  private readbacks = 0;
  private missedTurns = 0;
  private unknownLanguageTurns = 0;
  // The language the call opened in, usually the one on file: the hand-off is said in it too.
  private readonly openingLanguage: Language;
  // Fields this turn actually changed, as opposed to values Claude merely repeated.
  private changedThisTurn = false;
  private escalated = new Set<Escalation>();
  private history: { speaker: "agent" | "resident"; text: string }[] = [];
  private lastAcknowledgment = "";

  constructor(options: ConversationOptions) {
    this.language = options.language;
    this.openingLanguage = options.language;
    this.record = { ...options.onFile };
    this.knownAddress = options.knownAddress;
    this.residentName = options.residentName;
    this.effects = options.effects;
    this.step = options.knownAddress ? "confirm_address" : "ask_address";
  }

  get stage(): Stage {
    return STAGE_OF[this.step];
  }

  get done() {
    return this.step === "done";
  }

  start(): AgentTurn {
    const lines = LINES[this.language];
    const opening = this.knownAddress
      ? [lines.greetOutbound(this.knownAddress, this.residentName)]
      : [lines.greetInbound, lines.askAddress];
    return this.say("", opening, false);
  }

  // A status change arrived mid-call: play the template, then pick the conversation back up.
  announce(template: string): AgentTurn {
    return this.say("", this.done ? [template] : [template, this.question()], false);
  }

  async hear(utterance: string): Promise<AgentTurn> {
    this.history.push({ speaker: "resident", text: utterance });
    let heard: Interpretation;
    try {
      heard = await interpret(this.turnContext(utterance));
    } catch (error) {
      console.error("[agent] interpreter failed", error);
      return this.say("", [LINES[this.language].repeatPrompt], false);
    }
    if (isNoise(heard)) return this.ignore();
    const previousLanguage = this.language;
    const switched = this.switchLanguageIfNeeded(heard.spokenLanguage);
    const transfer = switched ? { line: LINES[previousLanguage].transferOut, language: previousLanguage } : undefined;
    if (!switched && this.shouldHandOff(heard)) return this.handOffToPerson();
    if (heard.spokenLanguage === "other") return this.say("", [LINES[this.language].repeatPrompt], false);
    this.changedThisTurn = false;
    this.applyUpdates(heard.updates, heard.confidence);
    const urgent = this.handleEmergency(heard);
    for (const address of heard.neighborAddresses) this.effects.nominate(address);

    // Asking us to repeat, or to switch language, isn't a failed answer, so it doesn't use up a try.
    if (heard.wantsRepeat || (switched && heardNothing(heard))) return this.reply(heard, urgent, [], transfer);
    const transition = this.advance(heard);
    this.moveTo(transition.step);
    return this.reply(heard, urgent, transition.lines ?? [], transfer);
  }

  // After a transfer the new agent opens with transferIn, so there's no acknowledgment to lead with.
  private reply(heard: Interpretation, urgent: string[], extra: string[], transfer?: AgentTurn["transfer"]): AgentTurn {
    const status = this.effects.rideStatus()?.status ?? "none";
    const ack = guardAcknowledgment(heard.acknowledgment, status, this.language);
    const ride = heard.asksAboutRide && !this.done ? [this.rideLine()] : [];
    const closing = this.done ? this.closingLines() : [this.question()];
    const greeting = transfer ? [LINES[this.language].transferIn] : [];
    const sentences = [...greeting, ...urgent, ...extra, ...ride, ...closing].filter((line) => line !== "");
    const turn = this.say(transfer ? "" : this.freshAcknowledgment(ack.text), sentences, ack.blocked);
    return transfer ? { ...turn, transfer } : turn;
  }

  // The same acknowledgment twice in a row, or "got it", sounds like a machine not listening.
  // A repeated opener ("Okay, ..." after "Okay, ...") is dropped and the rest kept.
  private freshAcknowledgment(text: string) {
    const normalized = normalizeAck(text);
    if (normalized === "") return text;
    const previous = this.lastAcknowledgment;
    this.lastAcknowledgment = normalized;
    if (normalized === previous || /\bgot it\b/.test(normalized)) return "";
    if (firstWord(normalized) !== firstWord(previous)) return text;
    const rest = text.trim().replace(/^\S+?[,.!]?\s+/u, "");
    return rest === text.trim() ? "" : rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  private say(acknowledgment: string, sentences: string[], guardBlocked: boolean): AgentTurn {
    this.history.push({ speaker: "agent", text: [acknowledgment, ...sentences].filter(Boolean).join(" ") });
    return { acknowledgment, sentences, stage: this.stage, done: this.done, guardBlocked, ignored: false };
  }

  // Noise doesn't count as a missed turn or use up a try; the question stays where it was.
  private ignore(): AgentTurn {
    this.history.pop();
    return { acknowledgment: "", sentences: [], stage: this.stage, done: this.done, guardBlocked: false, ignored: true };
  }

  private turnContext(utterance: string): TurnContext {
    return {
      language: this.language,
      stage: this.step,
      question: this.question(),
      record: this.record,
      recentTurns: this.history.slice(-HISTORY_TURNS - 1, -1),
      utterance,
    };
  }

  // A named language we can't speak hands off at once. "other" can be one odd sentence, so it takes
  // two in a row; anything else unusable takes MAX_MISSED_TURNS in a row.
  private shouldHandOff(heard: Interpretation) {
    const spoken = heard.spokenLanguage;
    if (spoken !== "other" && !canSpeak(spoken)) return true;
    this.unknownLanguageTurns = spoken === "other" ? this.unknownLanguageTurns + 1 : 0;
    this.missedTurns = spoken === "other" || heardNothing(heard) ? this.missedTurns + 1 : 0;
    return this.unknownLanguageTurns >= MAX_UNKNOWN_LANGUAGE_TURNS || this.missedTurns >= MAX_MISSED_TURNS;
  }

  // Switching to a language we speak is progress, not a missed turn, so the hand-off counters reset.
  private switchLanguageIfNeeded(spoken: Interpretation["spokenLanguage"]) {
    if (!canSpeak(spoken) || spoken === this.language) return false;
    this.language = spoken;
    this.missedTurns = 0;
    this.unknownLanguageTurns = 0;
    this.effects.updateRecord({ language: spoken }, {});
    return true;
  }

  // Nobody can understand each other: flag the call for a person and end it without promising anything.
  private handOffToPerson(): AgentTurn {
    this.escalateOnce("language_barrier");
    this.moveTo("done");
    const languages = [...new Set<Language>([this.language, this.openingLanguage, "en"])];
    return this.say("", languages.map((language) => withSafety(LINES[language].languageBarrier, language)), false);
  }

  private applyUpdates(updates: AgentRecord, confidence: Confidence) {
    const changed = changedFields(this.record, updates);
    if (isEmpty(changed)) return;
    this.record = { ...this.record, ...changed };
    this.changedThisTurn = true;
    this.effects.updateRecord(changed, confidence);
  }

  private escalateOnce(kind: Escalation) {
    if (this.escalated.has(kind)) return false;
    this.escalated.add(kind);
    this.effects.escalate(kind);
    return true;
  }

  private handleEmergency(heard: Interpretation): string[] {
    if (heard.emergency === "none") return [];
    return this.escalateOnce(heard.emergency) ? [LINES[this.language].emergency] : [];
  }

  private moveTo(step: Step) {
    if (step === this.step) this.triesOnStep += 1;
    else this.triesOnStep = 0;
    this.step = step;
  }

  // Give up on a step after two tries rather than trap the resident in a loop.
  private retryOr(fallback: Step): Transition {
    return this.triesOnStep + 1 >= MAX_TRIES_PER_STEP ? { step: fallback } : { step: this.step };
  }

  private advance(heard: Interpretation): Transition {
    return STEP_HANDLERS[this.step](this, heard);
  }

  confirmAddress(heard: Interpretation): Transition {
    if (heard.answer === "yes") {
      if (!this.record.address && this.knownAddress) this.applyUpdates({ address: this.knownAddress }, { address: 0.95 });
      return { step: "can_leave" };
    }
    if (heard.updates.address) return { step: hasHouseNumber(this.record.address) ? "confirm_address" : "ask_address" };
    if (heard.answer === "no") return { step: "ask_address" };
    return this.addressRetry();
  }

  askAddress(heard: Interpretation): Transition {
    if (heard.updates.address && hasHouseNumber(this.record.address)) return { step: "confirm_address" };
    return this.addressRetry();
  }

  private addressRetry(): Transition {
    if (this.triesOnStep + 1 < MAX_TRIES_PER_STEP) return { step: this.step };
    const lines = this.escalateOnce("address_unconfirmed") ? [LINES[this.language].addressEscalated] : [];
    return { step: "can_leave", lines };
  }

  canLeave(): Transition {
    if (this.record.canLeave === "yes") return { step: this.record.hasCar === undefined ? "has_car" : this.afterCanLeave() };
    if (this.record.canLeave) return { step: "household" };
    return this.retryOr("household");
  }

  hasCar(heard: Interpretation): Transition {
    if (this.record.hasCar === undefined && heard.answer && heard.answer !== "unclear") {
      this.applyUpdates({ hasCar: heard.answer === "yes" }, { hasCar: 0.8 });
    }
    if (this.record.hasCar === undefined) return this.retryOr("household");
    return { step: this.afterCanLeave() };
  }

  // People leaving on their own skip the needs questions, but still hear a short read-back so a
  // mistaken "yes, we can get out" can be corrected.
  private afterCanLeave(): Step {
    return needsRide(this.record) ? "household" : "readback";
  }

  // After a correction, go back to the first thing the record is now missing.
  private nextMissing(): Step {
    if (!needsRide(this.record)) return "readback";
    if (this.record.peopleCount === undefined) return "household";
    if (this.record.mobility === undefined) return "needs";
    if (hasLimitedMobility(this.record) && this.record.assistanceRequired === undefined) return "assistance";
    return "readback";
  }

  household(): Transition {
    if (this.record.peopleCount !== undefined) return { step: "needs" };
    return this.retryOr("needs");
  }

  needs(heard: Interpretation): Transition {
    const confirmedOnFile = heard.answer === "yes" && isEmpty(heard.updates) && this.record.mobility !== undefined;
    if (heard.answer === "no" && this.record.mobility === undefined) {
      this.applyUpdates({ mobility: "walks" }, { mobility: 0.8 });
    }
    // A correction to something else (say, the head count) doesn't answer this question.
    const answered = confirmedOnFile || this.record.mobility !== undefined;
    if (!answered) return this.retryOr("readback");
    const needsAssistanceQuestion = hasLimitedMobility(this.record) && this.record.assistanceRequired === undefined;
    return { step: needsAssistanceQuestion ? "assistance" : "readback" };
  }

  assistance(heard: Interpretation): Transition {
    if (this.record.assistanceRequired === undefined && heard.answer === "no") {
      this.applyUpdates({ assistanceRequired: "none" }, { assistanceRequired: 0.7 });
    }
    if (this.record.assistanceRequired !== undefined) return { step: "readback" };
    return this.retryOr("readback");
  }

  readback(heard: Interpretation): Transition {
    this.readbacks += 1;
    if (this.readbacks >= MAX_READBACKS) return { step: "neighbor" };
    if (this.changedThisTurn) return { step: this.nextMissing(), lines: [LINES[this.language].readbackFixed] };
    if (heard.answer === "yes") return { step: "neighbor" };
    if (heard.answer === "no") return { step: "fix" };
    return { step: "readback" };
  }

  fix(): Transition {
    if (!this.changedThisTurn) return this.retryOr("neighbor");
    return { step: this.nextMissing(), lines: [LINES[this.language].readbackFixed] };
  }

  neighbor(): Transition {
    return { step: "done" };
  }

  question(): string {
    return QUESTIONS[this.step](this);
  }

  // A street with no house number can't be driven to, so the agent asks for the number.
  askAddressQuestion() {
    const lines = LINES[this.language];
    const street = this.record.address;
    return street && !hasHouseNumber(street) ? lines.askHouseNumber(street) : lines.askAddress;
  }

  addressQuestion() {
    const address = this.record.address ?? this.knownAddress;
    return address ? LINES[this.language].confirmAddress(address) : LINES[this.language].askAddress;
  }

  needsQuestion() {
    const lines = LINES[this.language];
    if (!this.record.mobility) return lines.askNeeds;
    return lines.askNeedsOnFile(lines.mobility[this.record.mobility]);
  }

  readbackQuestion() {
    return readback(this.record, this.language);
  }

  // Anyone who needs a ride hears exactly the status template, never improvised reassurance.
  rideLine() {
    const lines = LINES[this.language];
    const ride = this.effects.rideStatus();
    if (ride) return statusLine(ride, this.language) ?? lines.leaveNow;
    if (!needsRide(this.record)) return lines.leaveNow;
    return statusLine({ status: "received", driver: null }, this.language) ?? lines.leaveNow;
  }

  private closingLines() {
    return [this.rideLine(), LINES[this.language].goodbye];
  }
}

const normalizeAck = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
const firstWord = (normalized: string) => normalized.split(" ")[0];

// Claude judged it not meant for the agent, and it carries nothing we must act on.
function isNoise(heard: Interpretation) {
  return !heard.addressedToAgent && heard.emergency === "none" && isEmpty(heard.updates) && heard.neighborAddresses.length === 0;
}

// A turn that gave us nothing to work with: asked us to repeat, or answered nothing usable.
function heardNothing(heard: Interpretation) {
  if (heard.wantsRepeat) return true;
  const answered = heard.answer === "yes" || heard.answer === "no";
  return !answered && isEmpty(heard.updates) && heard.emergency === "none" && !heard.asksAboutRide && heard.neighborAddresses.length === 0;
}

const STEP_HANDLERS: Record<Step, (conversation: Conversation, heard: Interpretation) => Transition> = {
  ask_address: (c, heard) => c.askAddress(heard),
  confirm_address: (c, heard) => c.confirmAddress(heard),
  can_leave: (c) => c.canLeave(),
  has_car: (c, heard) => c.hasCar(heard),
  household: (c) => c.household(),
  needs: (c, heard) => c.needs(heard),
  assistance: (c, heard) => c.assistance(heard),
  readback: (c, heard) => c.readback(heard),
  fix: (c) => c.fix(),
  neighbor: (c) => c.neighbor(),
  done: () => ({ step: "done" }),
};

const QUESTIONS: Record<Step, (conversation: Conversation) => string> = {
  ask_address: (c) => c.askAddressQuestion(),
  confirm_address: (c) => c.addressQuestion(),
  can_leave: (c) => LINES[c.language].askCanLeave,
  has_car: (c) => LINES[c.language].askHasCar,
  household: (c) => LINES[c.language].askHousehold,
  needs: (c) => c.needsQuestion(),
  assistance: (c) => LINES[c.language].askAssistance,
  readback: (c) => c.readbackQuestion(),
  fix: (c) => LINES[c.language].whatToFix,
  neighbor: (c) => LINES[c.language].askNeighbor,
  done: (c) => LINES[c.language].goodbye,
};
