import type { Doc } from "../../convex/_generated/dataModel";
import { findApprovedAnswer } from "./answerLookup";
import { NOBODY } from "./answerPatterns";
import { AskVerdict, checkAsk, GoalPrompt } from "./askLine";
import { bankText, withApprovedAnswer } from "./approvedAnswers";
import { nameOnFile } from "../../lib/name-on-file";
import { guardAcknowledgment, GuardResult } from "./honesty";
import { canSpeak, Emergency, interpret, Interpretation, Rehearing, TurnContext } from "./interpreter";
import { quickReading } from "./quickAnswer";
import { AgentRecord, changedFields, Confidence, hasLimitedMobility, isEmpty, needsRide } from "./record";
import { echo, Language, LINES, readback, RequestStatus, RideStatus, statusLine, withSafety } from "./script";

// The deterministic half of the agent. It decides what to ask next and what may be said about a
// ride. Claude (interpreter.ts) reads the resident's words, writes a short acknowledgment, and may
// word the next question; its question is spoken only for the goal this class lands on (askLine.ts).
// Phone calls and the text endpoint (POST /turn) run this same class.

export type Stage = Doc<"calls">["stage"];
export type Escalation = Exclude<Emergency, "none"> | "address_unconfirmed" | "language_barrier";

type Step =
  | "ask_address"
  | "confirm_address"
  | "confirm_away"
  | "can_leave"
  | "has_car"
  | "household"
  | "needs"
  | "chair_kind"
  | "assistance"
  | "readback"
  | "fix"
  | "neighbor"
  | "hold"
  | "done";

const STAGE_OF: Record<Step, Stage> = {
  ask_address: "confirm_address",
  confirm_address: "confirm_address",
  confirm_away: "confirm_address",
  can_leave: "can_leave",
  has_car: "can_leave",
  household: "household",
  needs: "needs",
  chair_kind: "needs",
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
export const OUTLINE: Record<Step, OutlineStage> = {
  ask_address: OPEN,
  confirm_address: OPEN,
  confirm_away: OPEN,
  can_leave: NEEDS,
  has_car: NEEDS,
  household: NEEDS,
  needs: NEEDS,
  chair_kind: NEEDS,
  assistance: NEEDS,
  readback: CHECK,
  fix: CHECK,
  neighbor: CLOSE,
  hold: CLOSE,
  done: CLOSE,
};

// What the conversation does to the world. The phone call writes to Convex; the eval endpoint doesn't.
// What the 911 screen gives the conversation, in the call language (voice/agent/brief.ts).
export type CallScreen = { brief: string; fire: string | null; route: string | null };

export interface ConversationEffects {
  updateRecord(patch: AgentRecord & { language?: string }, confidence: Confidence): void;
  escalate(kind: Escalation): void;
  // danger: the person is dying, hurt or can't breathe now, so a dispatcher hears of it first.
  nominate(spokenAddress: string, danger?: boolean): void;
  rideStatus(): RideStatus;
  // The 911 screen for this home now, in the call language. Absent on calls without one (the eval).
  screen?(language: Language): CallScreen | null;
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
  // What the resident said, when the turn was read from a rehearing rather than the live transcript.
  heardAs?: string;
  // How the phone voice should say this turn: urgently when a medical emergency or flames were
  // raised this turn, slower when the resident asked to hear it again.
  deliveryCue?: { emergency: boolean; slower: boolean };
};

export type ConversationOptions = {
  language: Language;
  // What the agency already has on file. The agent confirms these rather than asking from scratch.
  onFile: AgentRecord;
  knownAddress?: string;
  residentName?: string;
  // The other residents on file, by name: a neighbor named without an address can still be found.
  neighborNames?: readonly string[];
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
// Quiet stretches in a row on hold before the goodbye. Status changes still reach them by callback.
const MAX_QUIET_ON_HOLD = 6;
// Turns a step waits on the resident's own question or a moment's pause before it counts as a try,
// so an answer the interpreter keeps missing can't hold the call on one question.
const MAX_HELD_TURNS = 2;
const HISTORY_TURNS = 6;

type Transition = { step: Step; lines?: string[] };
// stalled: the turn left the question where it was, so it is asked again in other words.
// passedOn: a "Thanks, I've passed on ..." line is said this turn, so it is the acknowledgment.
type ReplyOptions = { transfer?: AgentTurn["transfer"]; stalled: boolean; passedOn?: boolean };

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
  // The resident spoke about mobility on this call, so the file's version needs no confirming.
  private mobilityHeard = false;
  // Firefighters told us "wheelchair" alone isn't enough: a battery chair can weigh 400 pounds.
  // Settled once the resident says which kind, or answers the power-chair question.
  private chairKindKnown = false;
  // Claude's answers already given, with what each answered. The same answer to something new is
  // dropped ("I don't know where the fire is" three turns running); asked again, it is said again.
  private readonly repliesSaid = new Map<string, string>();
  // Neighbors already passed on, so one named on several turns is nominated and said back once.
  private readonly passedOn = new Set<string>();
  // Neighbors passed on as in danger: one named calmly first and then "he's dying" is passed on again.
  private readonly passedOnUrgent = new Set<string>();
  private readonly neighborNames: readonly string[];
  private readonly residentName?: string;
  private triesOnStep = 0;
  // Where the call picks back up when someone turns out to be at the home after all.
  private resumeStep: Step = "can_leave";
  private heldTurns = 0;
  private readbacks = 0;
  private missedTurns = 0;
  private unknownLanguageTurns = 0;
  // Fields this turn actually changed, as opposed to values Claude merely repeated.
  private changedThisTurn = false;
  private changesThisTurn: AgentRecord = {};
  private unsureThisTurn = false;
  private escalated = new Set<Escalation>();
  private history: { speaker: "agent" | "resident"; text: string }[] = [];
  private lastAcknowledgment = "";
  private holdTurns = 0;
  private holdStepsSaid = 0;
  private fireStepsGiven = false;
  private quietOnHold = 0;
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
    this.neighborNames = options.neighborNames ?? [];
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

  // A status change arrived mid-call: play the template, then pick the conversation back up. Three
  // status changes in a row re-asked the head-count question after each one, so a question already
  // asked twice with no answer since is left for the resident to answer.
  announce(template: string): AgentTurn {
    const resume = this.done || this.timesAskedSinceResident() >= MAX_ASKS_WITHOUT_ANSWER ? [] : [this.question()];
    return this.say("", [template, ...resume], false);
  }

  async hear(utterance: string): Promise<AgentTurn> {
    return (await this.read(utterance))();
  }

  // rehear: the phone line's way to transcribe this turn's audio again in other languages.
  async read(utterance: string, rehear?: Rehear): Promise<() => AgentTurn> {
    const heard = await this.understand(utterance, rehear);
    return () => this.respond(utterance, heard);
  }

  // Claude's reading of one utterance. It changes nothing, so a phone call can throw it away and
  // read again when the resident turns out to still be talking. Null when the interpreter failed.
  // A policy question Claude heard ("can my dog come?") then gets the agency's approved answer.
  async understand(utterance: string, rehear?: Rehear): Promise<Interpretation | null> {
    const quick = quickReading(utterance, this.step, this.language);
    if (quick) return quick;
    try {
      const context = this.turnContext(utterance);
      const first = await interpret(context);
      const heard = rehear && mayBeAnotherLanguage(first) ? await readRehearings(context, first, rehear) : first;
      return withApprovedAnswer(heard, await findApprovedAnswer(heard.policyQuestion));
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
    this.history.push({ speaker: "resident", text: heard?.heardAs ?? utterance });
    this.quietCheckIns = 0;
    this.quietOnHold = 0;
    if (!heard) return this.say("", [LINES[this.language].repeatPrompt], false);
    const turn = this.done ? this.afterGoodbye(heard) : this.answer(this.spokenAddressOnly(this.householdAddress(heard)));
    return heard.heardAs ? { ...turn, heardAs: heard.heardAs } : turn;
  }

  // An address given in answer to the address question is the one this call is about, even when the
  // caller is away: "I'm in the car, he's at our house, 3037 Ewing Street" was filed as a neighbor,
  // and the agent then said it couldn't catch the address and recorded none.
  private householdAddress(heard: Interpretation): Interpretation {
    const asking = (this.step === "ask_address" || this.step === "confirm_address") && !this.record.address && !this.knownAddress;
    const given = heard.neighborAddresses.find((place) => /^\s*\d/.test(place));
    if (!asking || heard.updates.address || !given) return heard;
    return {
      ...heard,
      updates: { ...heard.updates, address: given },
      confidence: { ...heard.confidence, address: 0.9 },
      neighborAddresses: heard.neighborAddresses.filter((place) => place !== given),
    };
  }

  // An address whose street nobody on the call said, and that isn't the one on record, is dropped.
  private spokenAddressOnly(heard: Interpretation): Interpretation {
    const address = heard.updates.address;
    const said = [...this.history.filter((line) => line.speaker === "resident").map((line) => line.text), this.record.address, this.knownAddress];
    if (!address || streetWasSaid(address, said.join(" "))) return heard;
    return { ...heard, updates: { ...heard.updates, address: undefined } };
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
    this.noteChairKind(heard);
    const away = this.awayTurn(heard);
    if (away) return away;
    const passed = this.passOn(heard);
    const urgent = [...this.handleEmergency(heard), ...passed];
    const passedOn = passed.length > 0;

    // Asking us to repeat, to wait, or something of their own, or switching language, isn't a
    // failed answer, so it doesn't use up a try.
    if (heard.wantsRepeat) this.shortReadback = false;
    if (switched && heardNothing(heard)) return this.reply(heard, urgent, [], { transfer, stalled: false, passedOn });
    const keeps = heard.wantsRepeat || this.holdsQuestion(heard);
    if (keeps) return this.reply(heard, urgent, [], { transfer, stalled: !heard.wantsRepeat, passedOn });
    const previousStep = this.step;
    const transition = this.advance(heard);
    this.moveTo(transition.step);
    const stalled = this.step === previousStep && !this.changedThisTurn;
    return this.reply(heard, urgent, transition.lines ?? [], { transfer, stalled, passedOn });
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
    this.noteChairKind(heard);
    const passed = this.passOn(heard);
    const urgent = [...this.handleEmergency(heard), ...passed];
    const passedOn = passed.length > 0;
    if (this.changedThisTurn || heard.wantsTime || heard.answer === "no") {
      const fixed = this.changedThisTurn ? [LINES[this.language].readbackFixed] : [];
      this.moveTo(this.nextMissing());
      return this.reply(heard, urgent, fixed, { stalled: false, passedOn });
    }
    const asked = urgent.length > 0 || heard.asksAboutRide || heard.asksWhatToDo || heard.asksFire || heard.asksRoute || heard.wantsRepeat || heard.reply !== "" || heard.neighborAddresses.length > 0;
    return asked ? this.reply(heard, urgent, [], { stalled: false, passedOn }) : this.say("", [], false);
  }

  // After a transfer the new agent opens with transferIn, and a goodbye after hold stands alone,
  // so neither leads with an acknowledgment.
  // When Claude's question is spoken it carries the acknowledgment, so neither the echo nor Claude's
  // separate ack is said as well.
  private reply(heard: Interpretation, urgent: string[], extra: string[], { transfer, stalled, passedOn = false }: ReplyOptions): AgentTurn {
    const status = this.effects.rideStatus()?.status ?? "none";
    const leavingHold = this.done && this.reachedHold;
    const answer = guardAcknowledgment(heard.reply, status, this.language, heard.approvedAnswer !== undefined);
    const givesTime = this.givesTime(heard, stalled);
    const greeting = transfer ? [LINES[this.language].transferIn] : [];
    const feeling = this.feelingLines(heard, status, urgent);
    const said = this.claudeAnswer(heard, answer, feeling);
    const told = [...urgent, ...extra, ...this.rideLines(heard), ...this.fireSafetyLines(heard), ...this.screenLines(heard), ...this.whatToDoLines(heard)].filter((line) => line !== "");
    const silent = Boolean(transfer) || leavingHold;
    const plain = !silent && !givesTime && told.length === 0;
    const asked = plain ? this.claudeQuestion(heard, [...greeting, ...feeling, ...said].length === 0) : NO_ASK;
    const { ack, next } = this.turnEnd(heard, asked, { status, silent, stalled, givesTime, passedOn });
    const sentences = [...new Set([...greeting, ...feeling, ...told, ...said, ...next])].filter((line) => line !== "");
    const turn = this.say(ack.text, sentences, ack.blocked || answer.blocked || asked.blocked);
    const deliveryCue = { emergency: heard.emergency !== "none", slower: heard.wantsRepeat };
    return { ...turn, acknowledgmentIsEcho: ack.isEcho, transfer, givesTime, deliveryCue };
  }

  // The answer changed something else ("it's just me") and left the question open: it is asked
  // again in other words, not word for word, unless they asked to hear it again.
  private askedLastTurn(heard: Interpretation) {
    const question = this.question();
    return !heard.wantsRepeat && question !== "" && this.lastAgentLine().includes(question);
  }

  private givesTime(heard: Interpretation, stalled: boolean) {
    return stalled && heard.wantsTime && !this.done && !this.holding && this.step !== "neighbor";
  }

  // The acknowledgment and the turn's last line: Claude's question alone, or the code's own
  // acknowledgment and question.
  private turnEnd(heard: Interpretation, asked: AskVerdict, turn: { status: RequestStatus | "none"; silent: boolean; stalled: boolean; givesTime: boolean; passedOn: boolean }) {
    if (asked.line) return { ack: NO_ACK, next: [asked.line] };
    const again = turn.stalled || this.askedLastTurn(heard);
    return { ack: this.acknowledgmentFor(heard, turn.status, turn.silent, turn.passedOn), next: this.nextLines(again, turn.givesTime) };
  }

  // Claude's wording of the next question, when it aimed at the step the code just landed on.
  // "Say that again?" hears the question as first put, and scripted steps never take Claude's words.
  private claudeQuestion(heard: Interpretation, opensTurn: boolean): AskVerdict {
    if (heard.wantsRepeat || !ASKABLE.has(this.step)) return NO_ASK;
    const verdict = checkAsk(heard.ask, {
      goal: this.step,
      templates: [this.question(), this.questionAgain()],
      language: this.language,
      heldDigits: this.step === "confirm_address" ? (this.record.address ?? this.knownAddress) : undefined,
      said: this.history.filter((line) => line.speaker === "agent").map((line) => line.text),
      opener: opensTurn ? firstWord(normalizeAck(this.lastAgentLine())) : undefined,
    });
    if (verdict.line) this.lastAcknowledgment = normalizeAck(verdict.line);
    return verdict;
  }

  // The goals Claude may word next, in the order the code asks them, from the current step on.
  // Each says when the code asks it; the read-back is listed so Claude knows to leave it to the code.
  private goalsAhead(): GoalPrompt[] {
    const from = GOAL_ORDER.indexOf(this.step);
    if (from < 0) return [];
    return GOAL_ORDER.slice(from)
      .filter((step) => step === this.step || STILL_OPEN[step](this))
      .map((step) => ({ goal: step, question: ASKABLE.has(step) ? QUESTIONS[step](this) : "", when: GOAL_WHEN[step], scripted: !ASKABLE.has(step) }));
  }

  private freshReply(text: string) {
    if (!this.isFreshReply(text)) return [];
    this.repliesSaid.set(normalizeAck(text), normalizeAck(this.lastResidentLine()));
    return [text];
  }

  // "I don't know who Paulina is either" after "I don't know who Paulina is from this call" is the
  // same answer again, so replies are compared by their opening words, not only exactly.
  // A question is owed an answer, so "I don't know that." to a second question is said again; only
  // a reply the caller heard on the agent's last turn is dropped, unless they asked the same again.
  private isFreshReply(text: string) {
    const normalized = normalizeAck(text);
    if (normalized === "") return false;
    const asked = normalizeAck(this.lastResidentLine());
    const answeredThisBefore = [...this.repliesSaid].some(([said, answered]) => answered === asked && sameGist(said, normalized));
    if (isQuestion(this.lastResidentLine())) return answeredThisBefore || !normalizeAck(this.lastAgentLine()).includes(normalized);
    return [...this.repliesSaid].every(([said, answered]) => answered === asked || !sameGist(said, normalized));
  }

  // Whether reply() will say something for Claude's reply: its words, or the status in their place.
  private replyWillPlay(heard: Interpretation) {
    const answer = guardAcknowledgment(heard.reply, this.effects.rideStatus()?.status ?? "none", this.language, heard.approvedAnswer !== undefined);
    return answer.blocked || this.isFreshReply(answer.text);
  }

  // A frightened caller hears their feeling named before the facts, once, not every turn.
  private feelingLines(heard: Interpretation, status: RequestStatus | "none", urgent: string[]) {
    const lifeThreat = urgent.includes(LINES[this.language].emergency);
    const written = heard.feeling === "" && lifeThreat ? LINES[this.language].frightening : heard.feeling;
    const feeling = guardAcknowledgment(written, status, this.language);
    const normalized = normalizeAck(feeling.text);
    if (feeling.blocked || normalized === "" || normalized === this.lastFeeling) return [];
    this.lastFeeling = normalized;
    return [feeling.text];
  }

  // Claude's answer to the resident's own question, after the same guard as the acknowledgment.
  // On hold a blocked answer is replaced by the status line, which says the true version, rather
  // than leaving the caller with silence (or, if they just heard it, by something to do meanwhile).
  // A reply naming the feeling again after the feeling line is scripted sympathy, and a ride
  // question is answered by the status line alone: "Is someone coming?" got "Yes, I'm staying on
  // the line with you." from Claude, which a caller hears as yes, someone is coming.
  private claudeAnswer(heard: Interpretation, answer: GuardResult, feeling: string[]) {
    if (answer.blocked) return this.holding ? [this.rideUpdate(heard)] : [];
    const repeatsFeeling = feeling.length > 0 && FEELING_WORDS.test(answer.text);
    return repeatsFeeling || heard.asksAboutRide ? [] : this.freshReply(answer.text);
  }

  // Facts the resident just gave are said back from templates, so "two people, with pets" is heard
  // in every language and can't overstate anything. Otherwise Claude's acknowledgment, guarded.
  // silent: a transfer opens with transferIn and a goodbye after hold stands alone.
  // Claude's ack for a neighbor ("Thanks, Boris up the stream.") came before "Thanks, I've passed on
  // Boris Nezlobin.", so the caller heard two thanks for one answer: the passed-on line stands alone.
  private acknowledgmentFor(heard: Interpretation, status: RequestStatus | "none", silent: boolean, passedOn: boolean) {
    const guarded = guardAcknowledgment(heard.acknowledgment, status, this.language);
    if (silent) return { text: "", blocked: guarded.blocked, isEcho: false };
    const heardBack = echo(this.changesThisTurn, this.language);
    if (heardBack !== "") return { text: heardBack, blocked: false, isEcho: true };
    if (passedOn) return { text: "", blocked: guarded.blocked, isEcho: false };
    return { text: this.freshAcknowledgment(guarded.text), blocked: guarded.blocked, isEcho: false };
  }

  // Asked to say it again, they hear the status in full; asked about the ride again, they hear that
  // nothing has changed. A real caller hung up after the full status three times in four turns.
  // A life threat on hold hears the full status unless it was just said: a panicking caller says
  // something frightening nearly every turn, and one heard the whole template seven times in six minutes.
  // Fire reached the home on this call, and on hold the caller pleads or asks about the ride. Claude
  // rarely asked for the fire-safety steps then, so callers with flames at the door heard only the
  // status (voice exam, stay_with_them). The agency's steps are given once, after the status.
  private fireSafetyLines(heard: Interpretation) {
    if (this.fireStepsGiven || !this.holding || !this.escalated.has("flames") || heard.approvedAnswer) return [];
    if (!heard.asksAboutRide && heard.feeling === "") return [];
    this.fireStepsGiven = true;
    return [bankText("trapped_by_fire", this.language) ?? ""];
  }

  private rideLines(heard: Interpretation) {
    if (this.holding && heard.wantsRepeat) return [this.repeatOnHold()];
    if (this.holding && heard.emergency !== "none") return this.rideJustSaid() ? [] : [this.rideLine()];
    return heard.asksAboutRide ? [this.rideUpdate(heard)] : [];
  }

  // "Hello?" just after the status is checking the line, not asking for the status again: a real
  // caller said it twice and heard the same five sentences twice.
  private repeatOnHold() {
    const checkingTheLine = isLineCheck(this.lastResidentLine()) && this.rideJustSaid();
    return checkingTheLine ? LINES[this.language].stillThere[STILL_ON_THE_LINE] : this.rideLine();
  }

  // "What should I bring?" gets the next of the fixed steps, never Claude's own advice. Someone
  // leaving on their own is told to go now.
  // "Where's the fire?" and "Which way do I go?" get the 911 screen's lines, never Claude's numbers.
  private screenLines(heard: Interpretation) {
    const screen = this.effects.screen?.(this.language);
    if (!screen) return [];
    return [heard.asksFire ? screen.fire : null, heard.asksRoute ? screen.route : null].filter((line): line is string => line !== null);
  }

  private whatToDoLines(heard: Interpretation) {
    if (!heard.asksWhatToDo) return [];
    // Someone leaving on their own also hears the fastest way out, unless they just asked for it.
    const route = heard.asksRoute ? null : this.effects.screen?.(this.language)?.route;
    if (this.record.canLeave === "yes" && !needsRide(this.record)) return [LINES[this.language].leaveNow, ...(route ? [route] : [])];
    // "Are we supposed to wait here?" got a packing tip; whether to wait is answered by the status
    // line, which ends with "If you can leave safely, leave now."
    if (ASKS_WHETHER_TO_WAIT.test(this.lastResidentLine())) return [this.rideLine()];
    return [this.nextHoldStep(true) ?? this.rideUpdate()];
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
    if (this.holding) return this.checkInOnHold();
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

  // A quiet line on hold hears the next thing to do while they wait, then a check that they're
  // still there, and after MAX_QUIET_ON_HOLD quiet stretches the goodbye.
  private checkInOnHold(): AgentTurn {
    this.quietOnHold += 1;
    if (this.quietOnHold > MAX_QUIET_ON_HOLD) return this.endHold();
    const { stillThere } = LINES[this.language];
    const line = this.nextHoldStep(false) ?? stillThere[(this.quietOnHold - 1) % stillThere.length];
    return this.say("", [line], false);
  }

  // The line went dead. With no address, nothing else puts this caller in front of a dispatcher,
  // so they are flagged before the reach ladder calls back.
  private loseContact(): AgentTurn {
    this.markLostContact();
    return this.say("", [withSafety(LINES[this.language].lostYou, this.language)], false);
  }

  // A live call that stayed quiet ends without a word. Once the record was read back, the call got
  // what it needed and only the neighbor question or the hold went unanswered; before that, it lost
  // contact and the reach ladder calls back.
  lineWentQuiet() {
    if (this.done) return;
    if (this.step === "neighbor" || this.holding) return this.moveTo("done");
    this.markLostContact();
  }

  private markLostContact() {
    this.lostContact = true;
    if (!this.record.address && !this.knownAddress) this.escalateOnce("address_unconfirmed");
    this.moveTo("done");
  }

  // The same rephrasing twice in a row sounds like a recording, so a second miss asks the question
  // as first put.
  private askAgain() {
    const again = this.questionAgain();
    return this.lastAgentLine().includes(again) ? this.question() : again;
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

  // Someone in the home raised a fire or medical emergency on this call. "I'm burning", then "I don't
  // like that answer" was read as nobody home, and the caller was told they were safe and hung up on.
  private dangerAtHome() {
    return [...this.escalated].some((kind) => kind !== "address_unconfirmed" && kind !== "language_barrier");
  }

  // Marking a home empty calls off its ride, so one reading of "nobody's home" isn't enough: the agent
  // asks first. The answer is still read for the step it came on, and the call resumes from there
  // unless they confirm nobody is there.
  private awayTurn(heard: Interpretation): AgentTurn | null {
    if (this.step === "confirm_away") return this.confirmsAway(heard) ? this.markAway(heard) : null;
    // "Just him, he's alone in the house" gives a head count: someone is there.
    const mayBeAway = heard.awayFromHome && heard.updates.peopleCount === undefined && !this.record.away && !this.dangerAtHome();
    return mayBeAway ? this.askAway(heard) : null;
  }

  private askAway(heard: Interpretation): AgentTurn {
    const urgent = this.handleEmergency(heard);
    const transition = this.advance(heard);
    this.resumeStep = transition.step;
    this.moveTo("confirm_away");
    return this.say("", [...urgent, ...(transition.lines ?? []), LINES[this.language].confirmAway], false);
  }

  private confirmsAway(heard: Interpretation) {
    return heard.answer === "no" && heard.updates.peopleCount === undefined && heard.emergency === "none" && !this.dangerAtHome();
  }

  // Someone is there, or two unclear answers: the call carries on, and the ride request stays open.
  confirmAway(heard: Interpretation): Transition {
    if (heard.answer === "yes" || this.triesOnStep + 1 >= MAX_TRIES_PER_STEP) return { step: this.resumeStep };
    return { step: "confirm_away" };
  }

  // Nobody is at the home: no ride goes there, and there is nothing more to ask. An emergency they
  // mention is still passed on first.
  private markAway(heard: Interpretation): AgentTurn {
    const urgent = this.handleEmergency(heard);
    this.applyUpdates({ away: true }, { away: 0.9 });
    this.moveTo("done");
    const lines = LINES[this.language];
    return this.say("", [...urgent, lines.awaySafe, lines.goodbye], false);
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
      goals: this.goalsAhead(),
      record: this.record,
      recentTurns: this.history.slice(-HISTORY_TURNS),
      neighborNames: this.neighborNames,
      brief: this.effects.screen?.(this.language)?.brief,
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
    if (updates.mobility !== undefined) this.mobilityHeard = true;
    const changed = changedFields(this.record, keepCantLeave(this.record, updates));
    if (isEmpty(changed)) return;
    this.record = { ...this.record, ...changed };
    this.changesThisTurn = { ...this.changesThisTurn, ...changed };
    this.changedThisTurn = true;
    this.effects.updateRecord(changed, confidence);
  }

  private noteChairKind(heard: Interpretation) {
    if (heard.saysChairKind && heard.updates.mobility !== undefined) this.chairKindKnown = true;
  }

  // A wheelchair heard on this call with no kind said. The agency's file already says which kind.
  private needsChairKind() {
    const { mobility } = this.record;
    return mobility === "manual_wheelchair" && mobility !== this.onFile.mobility && !this.chairKindKnown;
  }

  private escalateOnce(kind: Escalation) {
    if (this.escalated.has(kind)) return false;
    this.escalated.add(kind);
    this.effects.escalate(kind);
    return true;
  }

  // A neighbor's address is said back from a template, since the guard keeps digits out of Claude's words.
  // A neighbor in danger is passed on again even if named before, and the caller hears it went as urgent.
  private passOn(heard: Interpretation): string[] {
    const danger = heard.neighborInDanger === true;
    const passed = danger ? this.passedOnUrgent : this.passedOn;
    const fresh = heard.neighborAddresses.filter((place) => !passed.has(normalizeAck(place)));
    for (const place of fresh) {
      this.passedOn.add(normalizeAck(place));
      if (danger) this.passedOnUrgent.add(normalizeAck(place));
      this.effects.nominate(place, danger);
    }
    const said = fresh.flatMap((place) => this.passedOnLine(place));
    return danger && fresh.length > 0 ? [...said, LINES[this.language].neighborUrgent] : said;
  }

  // Only an address or a name on file is said back; "my mom's house" is passed on without a sentence that garbles it.
  private passedOnLine(place: string): string[] {
    const said = /^\s*\d/.test(place) ? place : this.neighborOnFile(place);
    return said ? [LINES[this.language].passedOn(said)] : [];
  }

  private neighborOnFile(place: string) {
    return nameOnFile(place, this.neighborNames);
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

  // Give up on a step after two tries rather than trap the resident in a loop. "I don't know" has no
  // better answer to wait for, so it moves on at once.
  private retryOr(fallback: Step): Transition {
    return this.triesOnStep + 1 >= MAX_TRIES_PER_STEP || this.unsureThisTurn ? { step: fallback } : { step: this.step };
  }

  private advance(heard: Interpretation): Transition {
    this.unsureThisTurn = heard.unsure === true;
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

  // "I don't know" answers this question: unsure, which needs a ride. Claude took it for a
  // question to itself and answered "I don't know that yet", leaving can-leave unrecorded.
  canLeave(): Transition {
    if (this.record.canLeave === undefined && UNSURE.test(this.lastResidentLine())) {
      this.applyUpdates({ canLeave: "unsure" }, { canLeave: 0.7 });
    }
    if (this.record.canLeave === "yes") return { step: this.record.hasCar === undefined ? "has_car" : this.afterCanLeave() };
    // What the Ready check already told us isn't asked again: the read-back confirms it all at once.
    if (this.record.canLeave) return { step: this.nextMissing() };
    return this.retryOr("household");
  }

  // "Nobody" answers "Do you have a car or someone who can drive you out?" with a no.
  hasCar(heard: Interpretation): Transition {
    const nobody = NOBODY.test(this.lastResidentLine()) ? "no" : null;
    const answer = heard.answer && heard.answer !== "unclear" ? heard.answer : nobody;
    if (this.record.hasCar === undefined && answer) this.applyUpdates({ hasCar: answer === "yes" }, { hasCar: 0.8 });
    if (this.record.hasCar === undefined) return this.retryOr("household");
    return { step: this.afterCanLeave() };
  }

  // People leaving on their own skip the needs questions, but still hear a short read-back so a
  // mistaken "yes, we can get out" can be corrected.
  private afterCanLeave(): Step {
    return needsRide(this.record) ? this.nextMissing() : "readback";
  }

  // Everything the read-back would say about the home is still as the Ready check recorded it.
  private readbackIsOnFile() {
    if (this.onFile.peopleCount === undefined) return false;
    return ON_FILE_FIELDS.every((field) => JSON.stringify(this.record[field]) === JSON.stringify(this.onFile[field]));
  }

  // After a correction, go back to the first thing the record is now missing.
  private nextMissing(): Step {
    if (!needsRide(this.record)) return "readback";
    if (this.record.peopleCount === undefined) return "household";
    if (this.record.mobility === undefined) return "needs";
    if (this.needsChairKind()) return "chair_kind";
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
    return { step: this.afterMobility() };
  }

  private afterMobility(): Step {
    if (this.needsChairKind()) return "chair_kind";
    const needsAssistanceQuestion = hasLimitedMobility(this.record) && this.record.assistanceRequired === undefined;
    return needsAssistanceQuestion ? "assistance" : "readback";
  }

  // "Is it a power wheelchair?" A yes makes it one. A no, or naming either kind, settles it. After two
  // unclear tries it stays a manual chair rather than holding the call on one question.
  chairKind(heard: Interpretation): Transition {
    if (heard.answer === "yes" && this.record.mobility === "manual_wheelchair") {
      this.applyUpdates({ mobility: "power_wheelchair" }, { mobility: 0.8 });
    }
    const settled = heard.answer === "yes" || heard.answer === "no" || this.record.mobility !== "manual_wheelchair";
    if (!settled && !this.chairKindKnown && this.triesOnStep + 1 < MAX_TRIES_PER_STEP) return { step: "chair_kind" };
    this.chairKindKnown = true;
    return { step: this.afterMobility() };
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
    if (heard.answer === "yes" || restated(heard)) return { step: "neighbor" };
    if (heard.answer === "no") return { step: "fix" };
    this.shortReadback = true;
    return { step: "readback" };
  }

  fix(heard: Interpretation): Transition {
    if (!this.changedThisTurn) return restated(heard) ? { step: "neighbor" } : this.retryOr("neighbor");
    return { step: this.nextMissing(), lines: [LINES[this.language].readbackFixed] };
  }

  // "Yes, there's someone" with no address yet gets asked for it once.
  // "Yes, the house across the street" is asked once for the house number, so a field team can find it.
  neighbor(heard: Interpretation): Transition {
    const named = heard.answer === "yes" || heard.neighborAddresses.length > 0;
    const found = heard.neighborAddresses.some((place) => /^\s*\d/.test(place) || this.neighborOnFile(place) !== undefined);
    const owesAddress = named && !found && !heard.neighborInDanger;
    if (owesAddress && this.triesOnStep + 1 < MAX_TRIES_PER_STEP) return { step: "neighbor" };
    return this.afterNeighbor();
  }

  // Anyone waiting for a ride stays on the line instead of being hung up on.
  private afterNeighbor(): Transition {
    if (!needsRide(this.record)) return { step: "done" };
    this.reachedHold = true;
    return { step: "hold", lines: [this.rideUpdate()] };
  }

  // "Okay", "mm-hm" or "thank you" on hold needs no reply. Anything longer that nothing in the turn
  // answers hears where the ride stands, the one thing a caller on hold is asking about: a stock
  // "I'm still here" in its place was the line real callers heard over and over instead of an answer.
  // Claude's acknowledgment alone isn't an answer, and neither is a reply that won't be said again.
  hold(heard: Interpretation): Transition {
    this.holdTurns += 1;
    if (heard.wantsToEnd && !this.stillListening()) return { step: "done" };
    if (this.changedThisTurn) return { step: "hold", lines: [LINES[this.language].readbackFixed] };
    const urgent = heard.emergency !== "none" || heard.neighborAddresses.length > 0;
    const answered = urgent || heard.asksAboutRide || heard.asksWhatToDo || this.replyWillPlay(heard);
    return { step: "hold", lines: answered || this.brief(heard) ? [] : [this.holdAnswer()] };
  }

  // "Oh," or "okay" with nothing in it. A reply Claude wrote for it that was already said doesn't count.
  private brief(heard: Interpretation) {
    return isBrief(this.lastResidentLine()) && (heard.wantsRepeat || (answeredNothing(heard) && !heard.wantsTime));
  }

  // Where the ride stands, unless the caller just heard it; then something to do meanwhile, and once
  // those are said, nothing. "Nothing has changed" as filler answered "Okay, let me turn it on".
  private holdAnswer() {
    if (!this.rideJustSaid()) return this.rideLine();
    return this.nextHoldStep(false) ?? "";
  }

  // The status in full, or that it hasn't changed when they heard it in the last few agent turns.
  // A life threat is never told "Nothing has changed": "I can see the fire approaching" got that on a
  // real call. It hears the full status, whose last sentences say what to do if the hazard reaches
  // them, or nothing more when that was just said.
  // "Nothing has changed" only follows a status the caller was actually told. "Leave now" or "I need
  // the address" isn't one: said after those, it claimed an update that never happened.
  // A question asked right after the status is answered with its first sentences ("I've placed your
  // ride request..."), not "Nothing has changed": "Can anyone help me?" got that on a real call.
  // Asked again straight after the answer, the news is that nothing changed, not the answer again.
  private rideUpdate(heard?: Interpretation) {
    const lifeThreat = heard?.emergency !== undefined && heard.emergency !== "none";
    const asked = this.askedThisTurn(heard);
    if (asked && this.gaveRideAnswerLastTurn() && !lifeThreat && this.hasStatus()) return LINES[this.language].statusUnchanged;
    if (!this.rideJustSaid()) return this.rideLine();
    if (!this.hasStatus() || lifeThreat) return "";
    return asked ? this.rideAnswer() : LINES[this.language].statusUnchanged;
  }

  // The short answer alone, not the full status that starts with the same sentences: "Is the driver
  // still coming?" straight after the reassigning line got "Nothing has changed" and never heard that
  // the driver can't reach them.
  private gaveRideAnswerLastTurn() {
    const last = this.lastAgentLine();
    return last.includes(this.rideAnswer()) && !last.includes(this.rideLine());
  }

  private askedThisTurn(heard?: Interpretation) {
    return heard !== undefined && (heard.asksAboutRide || isQuestion(this.lastResidentLine()));
  }

  // Where the ride stands, without the promise to call back and the safety lines that follow it.
  rideAnswer() {
    return firstSentences(this.rideLine(), RIDE_ANSWER_SENTENCES);
  }

  private hasStatus() {
    return this.effects.rideStatus() !== null || (needsRide(this.record) && Boolean(this.record.address ?? this.knownAddress));
  }

  // Only the full line counts, so asked every few turns the caller still hears it in full now and then.
  private rideJustSaid() {
    const ride = this.rideLine();
    const recent = this.history.filter((line) => line.speaker === "agent").slice(-RECENT_AGENT_TURNS);
    return recent.some((line) => line.text.includes(ride));
  }

  // Agent turns since the resident last spoke that asked the current question, in either wording.
  private timesAskedSinceResident() {
    const asks = [this.question(), this.questionAgain()].filter((ask) => ask !== "");
    const since = this.history.slice(this.history.findLastIndex((line) => line.speaker === "resident") + 1);
    return since.filter((line) => asks.some((ask) => line.text.includes(ask))).length;
  }

  // The next of the steps for waiting. Once all are said: from the start again when asked, else null.
  private nextHoldStep(again: boolean) {
    const steps = LINES[this.language].holdSteps;
    if (this.holdStepsSaid >= steps.length && !again) return null;
    const step = steps[this.holdStepsSaid % steps.length];
    this.holdStepsSaid += 1;
    return step;
  }

  // "Okay" on hold means they are still there; a waiting caller is never hung up on without a goodbye.
  private stillListening() {
    const said = this.lastResidentLine();
    return wordCount(said) <= BRIEF_ACKNOWLEDGMENT_WORDS && !GOODBYE.test(said);
  }

  private lastAgentLine() {
    return this.history.findLast((line) => line.speaker === "agent")?.text ?? "";
  }

  private lastResidentLine() {
    return this.history.findLast((line) => line.speaker === "resident")?.text ?? "";
  }

  // Said once: a turn that keeps the question (asked to repeat) doesn't count as a hold turn.
  holdQuestion() {
    const { holdPrompt } = LINES[this.language];
    const said = this.history.some((line) => line.speaker === "agent" && line.text.includes(holdPrompt));
    return this.holdTurns === 0 && !said ? holdPrompt : "";
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
    const fromFile = mobility === this.onFile.mobility && !this.mobilityHeard;
    return fromFile ? lines.askNeedsOnFile(lines.mobility[mobility]) : lines.askOxygen;
  }

  readbackQuestion() {
    if (this.shortReadback) return LINES[this.language].readbackQuestion;
    return readback(this.record, this.language, this.readbackIsOnFile());
  }

  // Anyone who needs a ride hears exactly the status template, never improvised reassurance.
  rideLine() {
    const lines = LINES[this.language];
    const ride = this.effects.rideStatus();
    if (ride) return statusLine(ride, this.language) ?? lines.leaveNow;
    // Before any address there is no request to talk about, only what's needed to make one.
    if (!this.record.address && !this.knownAddress) return lines.needAddress;
    if (!needsRide(this.record)) return lines.leaveNow;
    // No request exists yet. "I've placed your ride request" here was said before any request was.
    return withSafety(lines.waitingForRequest, this.language);
  }

  // Someone coming off hold already heard where their ride stands.
  private closingLines() {
    const goodbye = LINES[this.language].goodbye;
    return this.reachedHold ? [goodbye] : [this.rideLine(), goodbye];
  }
}

// The fields a Ready check profile fills, which the read-back says back.
const ON_FILE_FIELDS = ["peopleCount", "mobility", "medical", "assistanceRequired", "pets"] as const;

const BRIEF_ACKNOWLEDGMENT_WORDS = 3;
const FEELING_WORDS = /(frighten|scar(y|ed)|terrif|afraid|worried|fear|asustad|miedo|aterr|preocupad)/i;
// How far back a status line still counts as just heard. Reaching hold three turns after a
// status change replayed the whole reassigning line twenty seconds after the first.
const RECENT_AGENT_TURNS = 3;
export const RIDE_ANSWER_SENTENCES = 2;
const ASKS_WHETHER_TO_WAIT = /\b(wait|stay)\b|\besper(o|ar|amos|ase|en)\b|\bqued(o|arme|arnos|amos)\b/i;
// Speech-to-text punctuates a question, in every language the line speaks.
const isQuestion = (text: string) => /[?？¿]/.test(text);
const STILL_ON_THE_LINE = 1;
// "Hello?", "Hello? Hello?", "Are you there?", "¿Bueno?", "喂？", "もしもし" and the like, alone.
const LINE_CHECK =
  /^(\s*(hello|hi|hey|are you (still )?there|you there|hola|bueno|al[oóô]|allô|oiga|喂|もしもし|여보세요|ал+о|हेलो)( po)?[\s?？¿!.,。]*)+$/iu;
export const isLineCheck = (text: string) => LINE_CHECK.test(text.trim());
// "I'm not leaving without my son" after "I can't get out" was read as unsure, and the agent then
// said "Thanks, I've fixed that" for a change nobody made. Unsure never replaces a recorded no.
function keepCantLeave(record: AgentRecord, updates: AgentRecord): AgentRecord {
  if (updates.canLeave !== "unsure" || record.canLeave !== "no") return updates;
  return { ...updates, canLeave: undefined };
}

const STREET_KINDS = new Set(["street", "avenue", "ave", "road", "boulevard", "blvd", "drive", "way", "lane", "court", "circle", "terrace", "trail", "parkway", "highway", "north", "south", "east", "west", "calle", "avenida", "camino"]);
const lettersOf = (text: string) => text.toLowerCase().normalize("NFD").replace(/[^\p{L}]/gu, "");

// Claude wrote "3426 Catherine Road" for "Can you send someone to my mom's house?", a street from its
// own prompt. A street counts as said when its name's letters appear in what was said, so a name
// spelled out ("M, A, R, I, P, O, S, A") counts too.
export function streetWasSaid(address: string, said: string) {
  const names = address.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length >= 3 && !STREET_KINDS.has(word));
  if (names.length === 0) return true;
  const spoken = lettersOf(said);
  return names.some((name) => spoken.includes(lettersOf(name)));
}

export const firstSentences = (text: string, count: number) =>
  text
    .split(/(?<=[.!?。！？])\s*/u)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
const MAX_ASKS_WITHOUT_ANSWER = 2;
const UNSURE = /^\s*(i don'?t know|i'?m not sure|not sure|no s[eé]\b|no estoy segur)/i;
const GOODBYE = /bye|adi[oó]s|chao|hasta luego|hang up|colg|再见|안녕|tạm biệt|paalam|до свидания|さようなら|失礼/i;
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const NO_ASK: AskVerdict = { line: null, blocked: false };
const NO_ACK = { text: "", blocked: false, isEcho: false };

// The steps Claude may word. The address is said back only from what the record holds; the
// read-back, the fix question, hold and the goodbye stay templates.
const ASKABLE = new Set<Step>(["ask_address", "confirm_address", "can_leave", "has_car", "household", "needs", "chair_kind", "assistance", "neighbor"]);
const GOAL_ORDER: Step[] = ["ask_address", "confirm_address", "can_leave", "has_car", "household", "needs", "chair_kind", "assistance", "readback", "neighbor"];
const NEEDS_A_RIDE = "only if canLeave is no or unsure, or hasCar is false";
const GOAL_WHEN: Partial<Record<Step, string>> = {
  confirm_address: "once they give an address with a house number",
  can_leave: "once the address is confirmed",
  has_car: "only if canLeave is yes",
  household: NEEDS_A_RIDE,
  needs: NEEDS_A_RIDE,
  chair_kind: "only if mobility is manual_wheelchair and they didn't say whether it has a motor",
  assistance: "only if mobility is walker, a wheelchair or bedbound",
  readback: "next once every goal above whose condition holds is answered",
};
// Whether a later goal is still to be asked, from the record before this answer.
const STILL_OPEN: Record<Step, (conversation: Conversation) => boolean> = {
  ask_address: () => false,
  confirm_address: () => true,
  confirm_away: () => false,
  can_leave: (c) => c.record.canLeave === undefined,
  has_car: (c) => c.record.hasCar === undefined && c.record.canLeave !== "no",
  household: (c) => c.record.peopleCount === undefined,
  needs: (c) => c.record.mobility === undefined,
  chair_kind: (c) => c.record.mobility === undefined || c.record.mobility === "manual_wheelchair",
  assistance: (c) => c.record.assistanceRequired === undefined,
  readback: () => true,
  fix: () => false,
  neighbor: () => true,
  hold: () => false,
  done: () => false,
};

// Chinese and Japanese have no spaces, so "我会死吗" counted as one word and a caller asking
// whether they would die got silence on hold. There, brief is "嗯", "好的" or "谢谢".
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const BRIEF_UNSPACED_CHARACTERS = 2;
function isBrief(text: string) {
  const bare = text.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  if (bare.includes(" ") || !UNSPACED.test(bare)) return wordCount(bare) <= BRIEF_ACKNOWLEDGMENT_WORDS;
  return [...bare].length <= BRIEF_UNSPACED_CHARACTERS;
}

const normalizeAck = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
const firstWord = (normalized: string) => normalized.split(" ")[0];

// Words, or characters for languages written without spaces.
const tokensOf = (normalized: string) => (normalized.includes(" ") ? normalized.split(" ") : [...normalized]);
const GIST_SHARE = 0.8;

// Two replies say the same thing when most of the shorter one is the other's opening.
function sameGist(a: string, b: string) {
  const [shorter, longer] = [tokensOf(a), tokensOf(b)].sort((x, y) => x.length - y.length);
  const shared = shorter.findIndex((token, index) => token !== longer[index]);
  return (shared === -1 ? shorter.length : shared) >= GIST_SHARE * shorter.length;
}

// A "correction" that says again what is already recorded confirms it: the caller is restating, and
// asking "What should I change?" again looped the call.
const restated = (heard: Interpretation) => !isEmpty(heard.updates);

export type Rehear = () => Promise<Rehearing[]>;

// Speech-to-text only writes the languages it listens for, so a resident speaking any other comes
// through as nonsense in the call language's words or script.
const mayBeAnotherLanguage = (heard: Interpretation) => heard.mistranscribed === true || heard.spokenLanguage === "other";

// The turn read as nonsense: its audio is transcribed again in the languages the live speech-to-text
// can't hear, and Claude reads all of them together. The first reading stands if that fails.
async function readRehearings(context: TurnContext, first: Interpretation, rehear: Rehear): Promise<Interpretation> {
  try {
    const rehearings = await rehear();
    if (rehearings.length === 0) return first;
    const heard = await interpret({ ...context, rehearings });
    const heardAs = rehearings.find((rehearing) => rehearing.language === heard.spokenLanguage)?.text;
    console.log(`[agent] reheard "${context.utterance}" in ${rehearings.map((r) => r.language).join(", ")}: read as ${heard.spokenLanguage}`);
    return heardAs ? { ...heard, heardAs } : heard;
  } catch (error) {
    console.error("[agent] rehearing failed", error);
    return first;
  }
}

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
  confirm_away: (c, heard) => c.confirmAway(heard),
  can_leave: (c) => c.canLeave(),
  has_car: (c, heard) => c.hasCar(heard),
  household: (c) => c.household(),
  needs: (c, heard) => c.needs(heard),
  chair_kind: (c, heard) => c.chairKind(heard),
  assistance: (c, heard) => c.assistance(heard),
  readback: (c, heard) => c.readback(heard),
  fix: (c, heard) => c.fix(heard),
  neighbor: (c, heard) => c.neighbor(heard),
  hold: (c, heard) => c.hold(heard),
  done: () => ({ step: "done" }),
};

const QUESTIONS: Record<Step, (conversation: Conversation) => string> = {
  ask_address: (c) => c.askAddressQuestion(),
  confirm_address: (c) => c.addressQuestion(),
  confirm_away: (c) => LINES[c.language].confirmAway,
  can_leave: (c) => LINES[c.language].askCanLeave,
  has_car: (c) => LINES[c.language].askHasCar,
  household: (c) => (c.record.pets === undefined ? LINES[c.language].askHousehold : LINES[c.language].askPeople),
  needs: (c) => c.needsQuestion(),
  chair_kind: (c) => LINES[c.language].askChairKind,
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
  confirm_away: (c) => LINES[c.language].confirmAwayAgain,
  can_leave: (c) => LINES[c.language].askAgain.canLeave,
  has_car: (c) => LINES[c.language].askAgain.hasCar,
  household: (c) => LINES[c.language].askAgain.household,
  needs: (c) => LINES[c.language].askAgain.needs,
  chair_kind: (c) => LINES[c.language].askAgain.chairKind,
  assistance: (c) => LINES[c.language].askAgain.assistance,
  readback: (c) => LINES[c.language].askAgain.readback,
  fix: (c) => LINES[c.language].askAgain.fix,
  neighbor: (c) => LINES[c.language].askAgain.neighbor,
  hold: (c) => c.holdQuestion(),
  done: (c) => LINES[c.language].goodbye,
};
