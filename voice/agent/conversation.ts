import type { Doc } from "../../convex/_generated/dataModel";
import { guardAcknowledgment } from "./honesty";
import { canSpeak, Emergency, interpret, Interpretation, TurnContext } from "./interpreter";
import { AgentRecord, changedFields, Confidence, hasLimitedMobility, isEmpty, needsRide } from "./record";
import { echo, Language, LINES, readback, RequestStatus, RideStatus, statusLine, withSafety } from "./script";

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
  | "hold"
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
  hold: "close",
  done: "close",
};

// The call outline: each step belongs to a stage with a goal, and Claude's words serve that goal
// rather than a fixed line. The greeting covers opening, trust and the core message, so steps start
// at confirming the place. Emergencies jump out of any stage (handleEmergency); a resident's own
// question is answered first and the stage then resumes (reply); a callback skips straight to news.
type OutlineStage = { stage: string; goal: string };
const OPEN: OutlineStage = {
  stage: "open",
  goal: "they know this is 911, that a warning covers them, and where they are right now",
};
const NEEDS: OutlineStage = {
  stage: "action and needs",
  goal: "find out only what dispatch needs to send the right help, and why it is asked",
};
const CHECK: OutlineStage = { stage: "check", goal: "the resident confirms the facts in their own words" };
const CLOSE: OutlineStage = {
  stage: "close",
  goal: "they know what happens next, and when to call this number back",
};
const OUTLINE: Record<Step, OutlineStage> = {
  ask_address: OPEN,
  confirm_address: OPEN,
  can_leave: NEEDS,
  has_car: NEEDS,
  household: NEEDS,
  needs: NEEDS,
  assistance: NEEDS,
  readback: CHECK,
  fix: CHECK,
  neighbor: CLOSE,
  hold: CLOSE,
  done: CLOSE,
};

// What the conversation does to the world. The phone call writes to Convex; the eval endpoint doesn't.
export interface ConversationEffects {
  updateRecord(patch: AgentRecord & { language?: string }, confidence: Confidence): void;
  escalate(kind: Escalation): void;
  nominate(spokenAddress: string): void;
  rideStatus(): RideStatus;
}

export type AgentTurn = {
  // What the agent heard, said first: a template echo of the facts the answer gave, or else Claude's
  // short acknowledgment through the honesty guard. The phone call drops Claude's after a
  // backchannel already covered the wait, but keeps an echo, since it carries the facts.
  acknowledgment: string;
  acknowledgmentIsEcho?: boolean;
  sentences: string[];
  stage: Stage;
  done: boolean;
  guardBlocked: boolean;
  // Background noise or talk not meant for the agent: nothing was said back and nothing changed.
  ignored: boolean;
  // Set when the resident switched language: said in the old language and voice before a pause.
  transfer?: { line: string; language: Language };
  // The resident asked for a moment, so the phone call waits longer before checking in.
  givesTime?: boolean;
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
// Quiet check-ins in a row before the call ends and the reach ladder calls back.
const MAX_QUIET_CHECK_INS = 2;
// Turns a step waits on the resident's own question or a moment's pause before it counts as a try,
// so an answer the interpreter keeps missing can't hold the call on one question.
const MAX_HELD_TURNS = 2;
const HISTORY_TURNS = 6;

type Transition = { step: Step; lines?: string[] };
// stalled: the turn left the question where it was, so it is asked again in other words.
type ReplyOptions = { transfer?: AgentTurn["transfer"]; stalled: boolean };

export class Conversation {
  language: Language;
  record: AgentRecord;
  step: Step;
  private readonly effects: ConversationEffects;
  private readonly knownAddress?: string;
  private readonly onFile: AgentRecord;
  // The resident said they aren't at the address on file, so it isn't theirs to flag.
  private knownAddressDenied = false;
  private lastFeeling = "";
  private readonly residentName?: string;
  private triesOnStep = 0;
  private heldTurns = 0;
  private readbacks = 0;
  private missedTurns = 0;
  private unknownLanguageTurns = 0;
  // Fields this turn actually changed, as opposed to values Claude merely repeated.
  private changedThisTurn = false;
  private changesThisTurn: AgentRecord = {};
  private escalated = new Set<Escalation>();
  private history: { speaker: "agent" | "resident"; text: string }[] = [];
  private lastAcknowledgment = "";
  private holdTurns = 0;
  // After an unclear reply to the read-back, ask "Is that right?" rather than read it all again.
  private shortReadback = false;
  private reachedHold = false;
  private quietCheckIns = 0;
  // Nobody can understand each other; nothing said after the hand-off changes the call.
  private handedOff = false;
  // The resident stopped answering and the call ended on a check-in, so it doesn't count as answered.
  lostContact = false;

  constructor(options: ConversationOptions) {
    this.language = options.language;
    this.onFile = options.onFile;
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

  // The questions are over and the resident is waiting on the line for a driver.
  get holding() {
    return this.step === "hold";
  }

  // The resident went quiet on hold for a long time: say goodbye so the line can close.
  endHold(): AgentTurn {
    this.moveTo("done");
    return this.say("", this.closingLines(), false);
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
    return (await this.read(utterance))();
  }

  async read(utterance: string): Promise<() => AgentTurn> {
    const heard = await this.understand(utterance);
    return () => this.respond(utterance, heard);
  }

  // Claude's reading of one utterance. It changes nothing, so a phone call can throw it away and
  // read again when the resident turns out to still be talking. Null when the interpreter failed.
  async understand(utterance: string): Promise<Interpretation | null> {
    try {
      return await interpret(this.turnContext(utterance));
    } catch (error) {
      console.error("[agent] interpreter failed", error);
      return null;
    }
  }

  // Acts on what understand() read. A goodbye isn't final: anything the resident adds after it is
  // heard too, so a late correction still reaches the record.
  respond(utterance: string, heard: Interpretation | null): AgentTurn {
    if (this.handedOff || (heard && isNoise(heard))) return this.ignore();
    if (!heard && this.done) return this.ignore();
    this.history.push({ speaker: "resident", text: utterance });
    this.quietCheckIns = 0;
    if (!heard) return this.say("", [LINES[this.language].repeatPrompt], false);
    return this.done ? this.afterGoodbye(heard) : this.answer(heard);
  }

  private answer(heard: Interpretation): AgentTurn {
    const previousLanguage = this.language;
    const switched = this.switchLanguageIfNeeded(heard.spokenLanguage);
    const transfer = switched ? { line: LINES[previousLanguage].transferOut, language: previousLanguage } : undefined;
    if (!switched && this.shouldHandOff(heard)) return this.handOffToPerson();
    if (heard.spokenLanguage === "other") return this.say("", [LINES[this.language].repeatPrompt], false);
    this.changedThisTurn = false;
    this.changesThisTurn = {};
    this.applyUpdates(heard.updates, heard.confidence);
    const urgent = this.handleEmergency(heard);
    for (const address of heard.neighborAddresses) this.effects.nominate(address);

    // Asking us to repeat, to wait, or something of their own, or switching language, isn't a
    // failed answer, so it doesn't use up a try.
    if (heard.wantsRepeat) this.shortReadback = false;
    if (switched && heardNothing(heard)) return this.reply(heard, urgent, [], { transfer, stalled: false });
    const keeps = heard.wantsRepeat || this.holdsQuestion(heard);
    if (keeps) return this.reply(heard, urgent, [], { transfer, stalled: !heard.wantsRepeat });
    const previousStep = this.step;
    const transition = this.advance(heard);
    this.moveTo(transition.step);
    const stalled = this.step === previousStep && !this.changedThisTurn;
    return this.reply(heard, urgent, transition.lines ?? [], { transfer, stalled });
  }

  // At the neighbor question "let me go check" ends the question rather than holding the line open.
  private holdsQuestion(heard: Interpretation) {
    if (this.holding || this.step === "neighbor" || !keepsQuestion(heard) || this.heldTurns >= MAX_HELD_TURNS) return false;
    this.heldTurns += 1;
    return true;
  }

  // Something said after the goodbye. A correction, "no, wait" or "hold on" reopens the call at what
  // is still missing, or the read-back; a question gets its answer and the goodbye again; "okay,
  // bye" says nothing and lets the line close.
  private afterGoodbye(heard: Interpretation): AgentTurn {
    this.changedThisTurn = false;
    this.changesThisTurn = {};
    this.applyUpdates(heard.updates, heard.confidence);
    const urgent = this.handleEmergency(heard);
    for (const address of heard.neighborAddresses) this.effects.nominate(address);
    if (this.changedThisTurn || heard.wantsTime || heard.answer === "no") {
      const fixed = this.changedThisTurn ? [LINES[this.language].readbackFixed] : [];
      this.moveTo(this.nextMissing());
      return this.reply(heard, urgent, fixed, { stalled: false });
    }
    const asked = urgent.length > 0 || heard.asksAboutRide || heard.wantsRepeat || heard.reply !== "" || heard.neighborAddresses.length > 0;
    return asked ? this.reply(heard, urgent, [], { stalled: false }) : this.say("", [], false);
  }

  // After a transfer the new agent opens with transferIn, and a goodbye after hold stands alone,
  // so neither leads with an acknowledgment.
  private reply(heard: Interpretation, urgent: string[], extra: string[], { transfer, stalled }: ReplyOptions): AgentTurn {
    const status = this.effects.rideStatus()?.status ?? "none";
    const leavingHold = this.done && this.reachedHold;
    const ack = this.acknowledgmentFor(heard, status, Boolean(transfer) || leavingHold);
    // Claude's answer to the resident's own question passes the same guard, and is dropped if blocked.
    // On hold the question is about the ride, so a dropped answer is replaced by the status line,
    // which says the true version, rather than leaving the caller with silence.
    const answer = guardAcknowledgment(heard.reply, status, this.language);
    const givesTime = stalled && heard.wantsTime && !this.done && !this.holding && this.step !== "neighbor";
    const greeting = transfer ? [LINES[this.language].transferIn] : [];
    const said = answer.blocked ? (this.holding ? [this.rideLine()] : []) : [answer.text];
    const lines = [...greeting, ...this.feelingLines(heard, status), ...urgent, ...extra, ...this.rideLines(heard), ...said, ...this.nextLines(stalled, givesTime)];
    const sentences = [...new Set(lines)].filter((line) => line !== "");
    const turn = this.say(ack.text, sentences, ack.blocked || answer.blocked);
    return { ...turn, acknowledgmentIsEcho: ack.isEcho, transfer, givesTime };
  }

  // A frightened caller hears their feeling named before the facts, once, not every turn.
  private feelingLines(heard: Interpretation, status: RequestStatus | "none") {
    const feeling = guardAcknowledgment(heard.feeling, status, this.language);
    const normalized = normalizeAck(feeling.text);
    if (feeling.blocked || normalized === "" || normalized === this.lastFeeling) return [];
    this.lastFeeling = normalized;
    return [feeling.text];
  }

  // Facts the resident just gave are said back from templates, so "two people, with pets" is heard
  // in every language and can't overstate anything. Otherwise Claude's acknowledgment, guarded.
  // silent: a transfer opens with transferIn and a goodbye after hold stands alone.
  private acknowledgmentFor(heard: Interpretation, status: RequestStatus | "none", silent: boolean) {
    const guarded = guardAcknowledgment(heard.acknowledgment, status, this.language);
    if (silent) return { text: "", blocked: guarded.blocked, isEcho: false };
    const heardBack = echo(this.changesThisTurn, this.language);
    if (heardBack !== "") return { text: heardBack, blocked: false, isEcho: true };
    return { text: this.freshAcknowledgment(guarded.text), blocked: guarded.blocked, isEcho: false };
  }

  private rideLines(heard: Interpretation) {
    const repeatOnHold = this.holding && heard.wantsRepeat;
    return heard.asksAboutRide || repeatOnHold ? [this.rideLine()] : [];
  }

  // What ends a turn: the goodbye, a moment's wait the resident asked for, or the next question,
  // in other words when it is the same question as last time.
  private nextLines(stalled: boolean, givesTime: boolean) {
    if (this.done) return this.closingLines();
    if (givesTime) return [LINES[this.language].takeYourTime];
    return [stalled ? this.askAgain() : this.question()];
  }

  // The line went quiet after a question: check in and ask it again in other words. After
  // MAX_QUIET_CHECK_INS the call ends and the reach ladder calls back, since silence is never
  // taken as an answer. A quiet line at the neighbor question just means nobody comes to mind.
  checkIn(): AgentTurn {
    const lines = LINES[this.language];
    if (this.step === "neighbor") {
      const transition = this.afterNeighbor();
      this.moveTo(transition.step);
      return this.say("", [...(transition.lines ?? []), ...this.nextLines(false, false)], false);
    }
    this.quietCheckIns += 1;
    if (this.quietCheckIns > MAX_QUIET_CHECK_INS) return this.loseContact();
    const stillThere = lines.stillThere[(this.quietCheckIns - 1) % lines.stillThere.length];
    return this.say("", [stillThere, this.askAgain()], false);
  }

  // The line went dead. With no address, nothing else puts this caller in front of a dispatcher,
  // so they are flagged before the reach ladder calls back.
  private loseContact(): AgentTurn {
    this.lostContact = true;
    if (!this.record.address && !this.knownAddress) this.escalateOnce("address_unconfirmed");
    this.moveTo("done");
    return this.say("", [withSafety(LINES[this.language].lostYou, this.language)], false);
  }

  // The same rephrasing twice in a row sounds like a recording, so a second miss asks the question
  // as first put.
  private askAgain() {
    const again = this.questionAgain();
    const lastSaid = this.history.findLast((line) => line.speaker === "agent")?.text ?? "";
    return lastSaid.includes(again) ? this.question() : again;
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
    const text = [acknowledgment, ...sentences].filter(Boolean).join(" ");
    if (text !== "") this.history.push({ speaker: "agent", text });
    return { acknowledgment, sentences, stage: this.stage, done: this.done, guardBlocked, ignored: false };
  }

  // Noise doesn't count as a missed turn or use up a try; the question stays where it was.
  private ignore(): AgentTurn {
    return { acknowledgment: "", sentences: [], stage: this.stage, done: this.done, guardBlocked: false, ignored: true };
  }

  private turnContext(utterance: string): TurnContext {
    return {
      language: this.language,
      stage: this.step,
      outline: OUTLINE[this.step],
      question: this.question(),
      record: this.record,
      recentTurns: this.history.slice(-HISTORY_TURNS),
      utterance,
    };
  }

  // A named language we can't speak hands off at once. "other" can be one odd sentence, so it takes
  // two in a row; anything else unusable takes MAX_MISSED_TURNS in a row.
  private shouldHandOff(heard: Interpretation) {
    const spoken = heard.spokenLanguage;
    if (spoken !== "other" && !canSpeak(spoken)) return true;
    this.unknownLanguageTurns = spoken === "other" ? this.unknownLanguageTurns + 1 : 0;
    // On hold, "okay" or "mm-hm" is a fine thing to say and never a reason to hand off.
    // Neither is "say that again?", which shows they're following along in a language we speak.
    const missed = spoken === "other" || (heardNothing(heard) && !this.holding && !heard.wantsRepeat);
    this.missedTurns = missed ? this.missedTurns + 1 : 0;
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
  // One language and English, not a run of three that a confused resident has to sit through.
  private handOffToPerson(): AgentTurn {
    this.escalateOnce("language_barrier");
    this.handedOff = true;
    this.moveTo("done");
    const languages = [...new Set<Language>([this.language, "en"])];
    return this.say("", languages.map((language) => withSafety(LINES[language].languageBarrier, language)), false);
  }

  private applyUpdates(updates: AgentRecord, confidence: Confidence) {
    const changed = changedFields(this.record, updates);
    if (isEmpty(changed)) return;
    this.record = { ...this.record, ...changed };
    this.changesThisTurn = { ...this.changesThisTurn, ...changed };
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
    if (step !== this.step) this.heldTurns = 0;
    if (step !== this.step) this.shortReadback = false;
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
    if (heard.answer === "no") this.knownAddressDenied = true;
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
    const heardAnAddress = Boolean(this.record.address ?? (this.knownAddressDenied ? undefined : this.knownAddress));
    const line = heardAnAddress ? LINES[this.language].addressEscalated : LINES[this.language].addressMissing;
    const lines = this.escalateOnce("address_unconfirmed") ? [line] : [];
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
    this.shortReadback = false;
    if (this.changedThisTurn) return { step: this.nextMissing(), lines: [LINES[this.language].readbackFixed] };
    if (heard.answer === "yes") return { step: "neighbor" };
    if (heard.answer === "no") return { step: "fix" };
    this.shortReadback = true;
    return { step: "readback" };
  }

  fix(): Transition {
    if (!this.changedThisTurn) return this.retryOr("neighbor");
    return { step: this.nextMissing(), lines: [LINES[this.language].readbackFixed] };
  }

  // "Yes, there's someone" with no address yet gets asked for it once.
  // "Yes, the house across the street" is asked once for the house number, so a field team can find it.
  neighbor(heard: Interpretation): Transition {
    const named = heard.answer === "yes" || heard.neighborAddresses.length > 0;
    const owesAddress = named && !heard.neighborAddresses.some((place) => /^\s*\d/.test(place));
    if (owesAddress && this.triesOnStep + 1 < MAX_TRIES_PER_STEP) return { step: "neighbor" };
    return this.afterNeighbor();
  }

  // Anyone waiting for a ride stays on the line instead of being hung up on.
  private afterNeighbor(): Transition {
    if (!needsRide(this.record)) return { step: "done" };
    this.reachedHold = true;
    return { step: "hold", lines: [this.rideLine()] };
  }

  // "Okay", "mm-hm" or "thank you" on hold needs no reply. Anything longer that nothing in the turn
  // answers hears where the ride stands, the one thing a caller on hold is asking about: a stock
  // "I'm still here" in its place was the line real callers heard over and over instead of an answer.
  hold(heard: Interpretation): Transition {
    this.holdTurns += 1;
    if (heard.wantsToEnd && !this.stillListening()) return { step: "done" };
    if (this.changedThisTurn) return { step: "hold", lines: [LINES[this.language].readbackFixed] };
    const answered = heard.reply !== "" || heard.asksAboutRide;
    const brief = heardNothing(heard) && wordCount(this.lastResidentLine()) <= BRIEF_ACKNOWLEDGMENT_WORDS;
    return { step: "hold", lines: answered || brief ? [] : [this.rideLine()] };
  }

  // "Okay" on hold means they are still there; a waiting caller is never hung up on without a goodbye.
  private stillListening() {
    const said = this.lastResidentLine();
    return wordCount(said) <= BRIEF_ACKNOWLEDGMENT_WORDS && !GOODBYE.test(said);
  }

  private lastResidentLine() {
    return this.history.findLast((line) => line.speaker === "resident")?.text ?? "";
  }

  holdQuestion() {
    return this.holdTurns === 0 ? LINES[this.language].holdPrompt : "";
  }

  question(): string {
    return QUESTIONS[this.step](this);
  }

  questionAgain(): string {
    return QUESTIONS_AGAIN[this.step](this);
  }

  // A street with no house number can't be driven to, so the agent asks for the number.
  askAddressQuestion() {
    const lines = LINES[this.language];
    const street = this.record.address;
    return street && !hasHouseNumber(street) ? lines.askHouseNumber(street) : lines.askAddress;
  }

  askAddressAgain() {
    const again = LINES[this.language].askAgain;
    const street = this.record.address;
    return street && !hasHouseNumber(street) ? again.houseNumber(street) : again.address;
  }

  addressQuestion() {
    const address = this.record.address ?? this.knownAddress;
    return address ? LINES[this.language].confirmAddress(address) : LINES[this.language].askAddress;
  }

  addressAgain() {
    const address = this.record.address ?? this.knownAddress;
    return address ? LINES[this.language].askAgain.confirmAddress(address) : LINES[this.language].askAgain.address;
  }

  // "Our records say" quotes only what came from the file. Mobility already heard on this call
  // needs no confirming, so only oxygen is left to ask.
  needsQuestion() {
    const lines = LINES[this.language];
    const { mobility } = this.record;
    if (!mobility) return lines.askNeeds;
    return mobility === this.onFile.mobility ? lines.askNeedsOnFile(lines.mobility[mobility]) : lines.askOxygen;
  }

  readbackQuestion() {
    if (this.shortReadback) return LINES[this.language].readbackQuestion;
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

  // Someone coming off hold already heard where their ride stands.
  private closingLines() {
    const goodbye = LINES[this.language].goodbye;
    return this.reachedHold ? [goodbye] : [this.rideLine(), goodbye];
  }
}

const BRIEF_ACKNOWLEDGMENT_WORDS = 3;
const GOODBYE = /bye|adi[oó]s|chao|hasta luego|hang up|colg|再见|안녕|tạm biệt|paalam|до свидания|さようなら|失礼/i;
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const normalizeAck = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
const firstWord = (normalized: string) => normalized.split(" ")[0];

// Claude judged it not meant for the agent, and it carries nothing we must act on.
function isNoise(heard: Interpretation) {
  return !heard.addressedToAgent && heard.emergency === "none" && isEmpty(heard.updates) && heard.neighborAddresses.length === 0;
}

// Nothing in the turn answers anything: no yes or no, no field, no emergency, ride question or neighbor.
function answeredNothing(heard: Interpretation) {
  const answered = heard.answer === "yes" || heard.answer === "no";
  return !answered && isEmpty(heard.updates) && heard.emergency === "none" && !heard.asksAboutRide && heard.neighborAddresses.length === 0;
}

// A turn that gave us nothing to work with: asked us to repeat, or said nothing usable. Asking for a
// moment or asking something of their own is the resident engaging, so it doesn't count.
function heardNothing(heard: Interpretation) {
  if (heard.wantsRepeat) return true;
  return answeredNothing(heard) && !heard.wantsTime && heard.reply === "";
}

// The resident asked us to repeat, asked for a moment, or asked something of their own without
// answering: the question stays where it is.
function keepsQuestion(heard: Interpretation) {
  return heard.wantsRepeat || (answeredNothing(heard) && (heard.wantsTime || heard.reply !== ""));
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
  neighbor: (c, heard) => c.neighbor(heard),
  hold: (c, heard) => c.hold(heard),
  done: () => ({ step: "done" }),
};

const QUESTIONS: Record<Step, (conversation: Conversation) => string> = {
  ask_address: (c) => c.askAddressQuestion(),
  confirm_address: (c) => c.addressQuestion(),
  can_leave: (c) => LINES[c.language].askCanLeave,
  has_car: (c) => LINES[c.language].askHasCar,
  household: (c) => (c.record.pets === undefined ? LINES[c.language].askHousehold : LINES[c.language].askPeople),
  needs: (c) => c.needsQuestion(),
  assistance: (c) => LINES[c.language].askAssistance,
  readback: (c) => c.readbackQuestion(),
  fix: (c) => LINES[c.language].whatToFix,
  neighbor: (c) => LINES[c.language].askNeighbor,
  hold: (c) => c.holdQuestion(),
  done: (c) => LINES[c.language].goodbye,
};

const QUESTIONS_AGAIN: Record<Step, (conversation: Conversation) => string> = {
  ask_address: (c) => c.askAddressAgain(),
  confirm_address: (c) => c.addressAgain(),
  can_leave: (c) => LINES[c.language].askAgain.canLeave,
  has_car: (c) => LINES[c.language].askAgain.hasCar,
  household: (c) => LINES[c.language].askAgain.household,
  needs: (c) => LINES[c.language].askAgain.needs,
  assistance: (c) => LINES[c.language].askAgain.assistance,
  readback: (c) => LINES[c.language].askAgain.readback,
  fix: (c) => LINES[c.language].askAgain.fix,
  neighbor: (c) => LINES[c.language].askAgain.neighbor,
  hold: (c) => c.holdQuestion(),
  done: (c) => LINES[c.language].goodbye,
};
