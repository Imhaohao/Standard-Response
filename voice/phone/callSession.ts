import type WebSocket from "ws";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CallFlow } from "../agent/callFlow";
import { AgentTurn, Conversation, ConversationEffects } from "../agent/conversation";
import { Language, languageOf, LINES, RideStatus } from "../agent/script";
import { convex, fireAndForget, logSubscriptionError } from "../convex";
import { Transcriber } from "./cartesia";
import { ElevenLabsCall } from "./elevenLabsCall";
import { householdCallFor, onFileRecord } from "./householdCall";
import { interrupts, isBackchannel } from "./interruption";
import { isOutboundFlowMode, outboundFlowFor } from "./outboundFlows";
import { callbackScripts, callEnded, LiveCall, liveByCallSid, liveByHousehold, registerLive } from "./registry";
import { CallSpeech } from "./speech";
import { CallMode, hangUp, StreamParameters } from "./twilio";
import { env } from "../env";

// One live phone call: Twilio audio in, Cartesia speech-to-text, the conversation, Cartesia voice out.

// Silence after a finalized transcript before we treat the resident's turn as over. A stop mark only
// ends a sentence, not the turn: older residents often add a second sentence after a breath ("I'm at
// 12 Oak Street. It's the blue house."), and 300 ms cut that breath off. A transcript that trails off
// ("my address is...", "现在在，") means the resident paused mid-thought, so we wait longer. Many
// transcripts, Chinese ones especially, carry no mark either way; they get the middle wait, and a
// resident who keeps talking is still heard (takeTurn reads the rest again).
const TURN_GAP_MS = 700;
const UNMARKED_TURN_GAP_MS = 1000;
const UNFINISHED_TURN_GAP_MS = 1800;
const SENTENCE_END = /[.?!。？！]["'”」』)]?$/;
const TRAILING_OFF = /(\.\.\.|…|[,、，:;\-–—])$/;
// The resident kept talking while Claude read their first words: read it all again, this many times
// at most, so a television in the background can't hold the call up forever.
const MAX_REREADS = 2;
// If Claude hasn't answered by then, a short backchannel covers the wait.
const BACKCHANNEL_AFTER_MS = 300;
// A listening noise ("mm-hm", "yeah") said under the agent's voice takes no turn, unless the agent
// finished within this long of it: then it was the answer to what the agent was asking.
const OVERLAP_ANSWER_MS = 1200;
// Quiet between the old-language agent's "let me transfer you" and the new one coming on.
const TRANSFER_PAUSE_MS = 1500;
// How long a quiet line waits, by what the call is waiting for:
// - answer: the agent asked a question; then it checks in and asks again in other words.
// - moment: the resident asked for a moment ("hold on, let me ask my wife").
// - hold: a resident on hold who says nothing for this long hears the next thing to do while they
//   wait, or a check that they're there; after several quiet stretches the flow says goodbye and
//   status changes reach them by callback instead.
// - goodbye: the goodbye has played; the line stays open this long in case they have more to say.
const QUIET_MS = { answer: 7000, moment: 20_000, hold: 30_000, goodbye: 2000 } as const;
type Waiting = keyof typeof QUIET_MS;

export type TwilioStart = { streamSid: string; callSid: string; customParameters: StreamParameters };
type TwilioMessage =
  | { event: "start"; start: TwilioStart }
  | { event: "media"; media: { payload: string; track?: string } }
  | { event: "mark"; mark: { name: string } }
  | { event: "stop" }
  | { event: "connected" };

type TurnTiming = { spokeAt: number; heardAt: () => number | null };

function turnGap(text: string) {
  const trimmed = text.trim();
  if (TRAILING_OFF.test(trimmed)) return UNFINISHED_TURN_GAP_MS;
  return SENTENCE_END.test(trimmed) ? TURN_GAP_MS : UNMARKED_TURN_GAP_MS;
}

function waitingAfter(turn: AgentTurn, holding: boolean): Waiting {
  if (turn.done) return "goodbye";
  if (holding) return "hold";
  return turn.givesTime ? "moment" : "answer";
}

// The household call runs on whichever stack VOICE_STACK picks; scripted calls stay on ours.
const HOUSEHOLD_MODES = new Set<CallMode>(["survey", "inbound"]);
type MediaSession = { begin(): Promise<void>; hearAudio(base64: string): void; markPlayed(): void; finish(answered: boolean | null): Promise<void> };

function sessionFor(socket: WebSocket, start: TwilioStart): MediaSession {
  if (env.voiceStack === "elevenlabs" && HOUSEHOLD_MODES.has(start.customParameters.mode)) return new ElevenLabsCall(socket, start);
  return new CallSession(socket, start);
}

export function handleMediaStream(socket: WebSocket) {
  let session: MediaSession | null = null;
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as TwilioMessage;
    if (message.event === "start") {
      session = sessionFor(socket, message.start);
      session.begin().catch((error) => {
        console.error("[call] failed to start", error);
        session?.finish(false);
      });
    } else if (message.event === "media") session?.hearAudio(message.media.payload);
    else if (message.event === "mark") session?.markPlayed();
    else if (message.event === "stop") session?.finish(null);
  });
  socket.on("close", () => session?.finish(null));
}

class CallSession implements LiveCall {
  householdId: string | null = null;
  private readonly params: StreamParameters;
  private readonly callSid: string;
  private readonly speech: CallSpeech;
  private transcriber: Transcriber | null = null;
  private conversation: CallFlow | null = null;
  private callId: Id<"calls"> | null = null;
  private language: Language = "en";
  private ride: RideStatus = null;
  private unsubscribe: (() => void) | null = null;
  private heardSoFar = "";
  private lastSpeechAt = 0;
  private turnTimer: NodeJS.Timeout | null = null;
  private waiting: Waiting | null = null;
  private quietTimer: NodeJS.Timeout | null = null;
  private rereads = 0;
  private thinking = false;
  // The resident stopped the agent mid-turn and hasn't been answered yet.
  private cutOff = false;
  private residentSpoke = false;
  private lastBackchannel = "";
  private reachedMachine = false;
  private ended = false;

  constructor(socket: WebSocket, start: TwilioStart) {
    this.params = start.customParameters;
    this.callSid = start.callSid;
    this.speech = new CallSpeech(socket, start.streamSid);
    registerLive(this.callSid, this);
  }

  async begin() {
    if (this.params.mode === "callback") return this.beginCallback();
    if (isOutboundFlowMode(this.params.mode)) return this.beginOutboundFlow();
    const householdId = await this.resolveHousehold();
    this.householdId = householdId;
    liveByHousehold.set(householdId, this);
    const household = await convex().query(api.voice.household, { householdId });
    if (!household) throw new Error(`Household ${householdId} not found`);
    this.language = languageOf(household.language);
    this.unsubscribe = convex().onUpdate(api.voice.statusFor, { householdId }, (ride) => {
      this.ride = ride;
    }, logSubscriptionError("statusFor"));
    this.conversation = new Conversation({
      language: this.language,
      onFile: onFileRecord(household),
      knownAddress: household.lat !== undefined ? household.address : undefined,
      residentName: household.residentName,
      effects: this.effects(householdId),
    });
    this.listen();
    if (this.callId) fireAndForget("setPhase", convex().mutation(api.calls.setPhase, { callId: this.callId, phase: "live" }));
    this.speakTurn(this.conversation.start(), null);
  }

  // The pickup check and the Ready check: short calls with their own state machine. Their `calls`
  // row is only for the call floor, so a failure to open it doesn't stop the call.
  private async beginOutboundFlow() {
    const { conversation, call } = await outboundFlowFor(this.params);
    this.conversation = conversation;
    this.callId = await convex().mutation(api.calls.startFlow, call).catch((error: unknown) => {
      console.error(`[call ${this.callSid}] could not open its call-floor row`, error);
      return null;
    });
    this.language = this.conversation.language;
    this.listen();
    this.speakTurn(this.conversation.start(), null);
  }

  private async resolveHousehold(): Promise<Id<"households">> {
    const { householdId, callId } = await householdCallFor(this.params);
    this.callId = callId;
    return householdId;
  }

  private effects(householdId: Id<"households">): ConversationEffects {
    return {
      updateRecord: (patch, confidence) =>
        fireAndForget("households.update", convex().mutation(api.households.update, { householdId, patch, confidence })),
      escalate: (kind) => fireAndForget("requests.escalate", convex().mutation(api.requests.escalate, { householdId, kind })),
      nominate: (spokenAddress) =>
        fireAndForget("nominations.add", convex().mutation(api.nominations.add, { fromHouseholdId: householdId, spokenAddress })),
      rideStatus: () => this.ride,
    };
  }

  private listen() {
    this.transcriber?.close();
    this.transcriber = new Transcriber(this.language, {
      onSpeech: (text, isFinal, voicedMs) => this.onSpeech(text, isFinal, voicedMs),
      onError: (message) => console.error(`[call ${this.callSid}] ${message}`),
    });
  }

  hearAudio(base64: string) {
    this.transcriber?.send(Buffer.from(base64, "base64"));
  }

  markPlayed() {
    this.speech.markPlayed();
  }

  // Talk under the agent's voice stops it only when the resident is really talking (see
  // interruption.ts); a finished transcript that didn't stop it waits for the agent to finish.
  private onSpeech(text: string, isFinal: boolean, voicedMs: number) {
    this.lastSpeechAt = Date.now();
    this.restartQuietTimer();
    if (this.speech.speaking) {
      if (interrupts(text, voicedMs, this.language)) {
        this.speech.bargeIn();
        this.cutOff = true;
      } else if (isFinal) return void this.heardUnderVoice(text);
    }
    if (isFinal) this.hear(text);
    else this.waitForTurnEnd();
  }

  private async heardUnderVoice(text: string) {
    const heardAt = Date.now();
    await this.speech.whenSilent();
    if (this.ended) return;
    if (isBackchannel(text, this.language) && Date.now() - heardAt > OVERLAP_ANSWER_MS) return;
    this.hear(text);
  }

  private hear(text: string) {
    this.heardSoFar = `${this.heardSoFar} ${text}`;
    this.waitForTurnEnd();
  }

  // Each word heard pushes the end of the resident's turn back.
  private waitForTurnEnd() {
    const soFar = this.heardSoFar.trim();
    if (soFar === "") return;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    const gap = turnGap(soFar);
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      void this.takeTurn();
    }, gap);
  }

  private async takeTurn() {
    if (this.thinking || !this.conversation || this.reachedMachine) return;
    const utterance = this.heardSoFar.trim();
    if (utterance === "") return;
    this.thinking = true;
    this.residentSpoke = true;
    const spokeAt = this.lastSpeechAt;
    // First audio the resident hears after they stop, whether the backchannel or the reply itself.
    let heardAt: number | null = null;
    let backchanneled = false;
    const backchannel = setTimeout(() => {
      // Never talk over a resident who has started again. A listening noise gets no "mm-hm" back:
      // it may have been a cough, and a short "yeah" reads fast enough not to need cover.
      if (this.lastSpeechAt !== spokeAt || isBackchannel(utterance, this.language)) return;
      backchanneled = true;
      this.speech.say([this.pickBackchannel()], this.language, () => {
        heardAt = Date.now();
        this.logLatency(spokeAt, "backchannel");
      });
    }, BACKCHANNEL_AFTER_MS);
    try {
      const act = await this.conversation.read(utterance);
      clearTimeout(backchannel);
      // They kept talking while Claude read the first part: answer all of it together instead. Any
      // speech counts, not only a finished transcript, so the reply never starts over a resident who
      // is mid-sentence; their next transcript restarts the turn timer.
      const resumed = this.lastSpeechAt !== spokeAt || this.heardSoFar.trim() !== utterance;
      if (resumed && this.rereads < MAX_REREADS) {
        this.rereads += 1;
        return;
      }
      this.rereads = 0;
      this.heardSoFar = this.heardSoFar.trim().slice(utterance.length);
      this.answer(utterance, act(), { spokeAt, heardAt: () => heardAt }, backchanneled);
    } catch (error) {
      console.error(`[call ${this.callSid}] turn failed`, error);
      this.restartQuietTimer();
    } finally {
      this.thinking = false;
      if (!this.turnTimer && this.heardSoFar.trim() !== "") void this.takeTurn();
    }
  }

  private answer(utterance: string, turn: AgentTurn, timing: TurnTiming, backchanneled: boolean) {
    this.logLine("resident", utterance);
    this.syncLanguage();
    const cutOff = this.cutOff;
    this.cutOff = false;
    if (turn.ignored) this.afterNoise(cutOff);
    else if (turn.transfer) void this.speakTransfer(turn, timing, turn.transfer);
    else this.speakTurn(turn, timing, backchanneled);
  }

  // A language switch plays as a transfer: the old voice signs off, a pause, then the new voice.
  private async speakTransfer(turn: AgentTurn, timing: TurnTiming, transfer: NonNullable<AgentTurn["transfer"]>) {
    this.waiting = null;
    this.restartQuietTimer();
    this.speech.say([transfer.line], transfer.language, () => this.logLine("agent", transfer.line, Date.now() - timing.spokeAt));
    await this.speech.whenSilent();
    await new Promise((resolve) => setTimeout(resolve, TRANSFER_PAUSE_MS));
    if (!this.ended) this.speakTurn(turn, null);
  }

  // A reply can finish after the caller hung up; there is no one left to say it to.
  // After a backchannel, Claude's "Okay" would say it twice; an echo of the facts still plays.
  private speakTurn(turn: AgentTurn, timing: TurnTiming | null, backchanneled = false) {
    if (this.ended) return;
    const dropAcknowledgment = backchanneled && !turn.acknowledgmentIsEcho;
    const sentences = [dropAcknowledgment ? "" : turn.acknowledgment, ...turn.sentences].filter((line) => line !== "");
    const text = sentences.join(" ");
    this.speech.say(sentences, this.language, () => {
      const firstAudio = timing?.heardAt() ?? Date.now();
      this.logLine("agent", text, timing ? firstAudio - timing.spokeAt : undefined);
    });
    if (this.callId) fireAndForget("setStage", convex().mutation(api.calls.setStage, { callId: this.callId, stage: turn.stage }));
    void this.waitAfter(turn);
  }

  // The quiet clock starts once the agent stops talking. Even after the goodbye the call only hangs
  // up when the line stays quiet, so a resident who is still talking is never cut off.
  private async waitAfter(turn: AgentTurn) {
    this.waiting = waitingAfter(turn, this.conversation?.holding ?? false);
    await this.speech.whenSilent();
    this.restartQuietTimer();
  }

  // Any sound from the resident restarts the clock, so it only runs out on a quiet line.
  private restartQuietTimer() {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    const waiting = this.waiting;
    if (waiting === null || this.ended) return;
    this.quietTimer = setTimeout(() => this.onQuiet(waiting), QUIET_MS[waiting]);
  }

  private onQuiet(waiting: Waiting) {
    this.quietTimer = null;
    const conversation = this.conversation;
    // Mid-turn: the reply that follows starts the clock again.
    if (this.ended || !conversation || this.thinking || this.speech.speaking || this.heardSoFar.trim() !== "") return;
    if (waiting === "goodbye") void this.finish(!conversation.lostContact);
    else if (waiting === "hold") this.speakTurn(conversation.checkIn?.() ?? conversation.endHold(), null);
    else if (conversation.checkIn) this.speakTurn(conversation.checkIn(), null);
  }

  private logLatency(spokeAt: number, label: string) {
    console.log(`[call ${this.callSid}] first audio (${label}) ${Date.now() - spokeAt}ms after the resident stopped`);
  }

  // Noise stays unanswered. The quiet clock picks up where it was, so if the resident really is
  // silent they get a check-in rather than the same question again. If it cut the agent off,
  // though, the question it was asking may never have been heard, so it asks it again.
  private afterNoise(cutOff: boolean) {
    const conversation = this.conversation;
    if (cutOff && conversation && !conversation.done && !this.speech.speaking) {
      const question = conversation.question();
      this.speech.say([question], this.language, () => this.logLine("agent", question));
    }
    void this.speech.whenSilent().then(() => this.restartQuietTimer());
  }

  private pickBackchannel() {
    const options = LINES[this.language].backchannels.filter((line) => line !== this.lastBackchannel);
    this.lastBackchannel = options[Math.floor(Math.random() * options.length)];
    return this.lastBackchannel;
  }

  // The resident switched languages mid-call: listen in the new one too.
  private syncLanguage() {
    if (!this.conversation || this.conversation.language === this.language) return;
    this.language = this.conversation.language;
    this.listen();
  }

  private logLine(speaker: "agent" | "resident", text: string, latencyMs?: number) {
    if (!this.callId || text === "") return;
    const requestStatus = speaker === "agent" ? this.ride?.status : undefined;
    fireAndForget("calls.say", convex().mutation(api.calls.say, { callId: this.callId, speaker, text, requestStatus, latencyMs }));
  }

  async announce(template: string, language?: Language) {
    if (!this.conversation) return;
    const turn = this.conversation.announce(template);
    this.speech.cutIn(turn.sentences, language ?? this.language);
    this.logLine("agent", turn.sentences.join(" "));
    await this.waitAfter(turn);
  }

  onMachine() {
    if (this.residentSpoke || this.ended) return;
    this.reachedMachine = true;
    this.waiting = null;
    this.restartQuietTimer();
    this.speech.bargeIn();
    const voicemail = this.params.mode === "callback"
      ? this.callbackSentences()
      : (this.conversation?.voicemail?.() ?? [LINES[this.language].voicemail]);
    this.speech.say(voicemail, this.language);
    void this.speech.whenSilent().then(() => this.finish(false));
  }

  private callbackSentences() {
    const script = callbackScripts.get(this.params.callbackId ?? "");
    return script?.sentences ?? [];
  }

  private async beginCallback() {
    const callbackId = this.params.callbackId as Id<"callbacks">;
    const script = callbackScripts.get(callbackId);
    this.householdId = this.params.householdId ?? null;
    if (!script) throw new Error(`No script for callback ${callbackId}`);
    this.language = script.language;
    this.speech.say(script.sentences, script.language);
    await this.speech.whenSilent();
    if (this.ended || this.reachedMachine) return;
    fireAndForget("callbacks.markPlayed", convex().mutation(api.callbacks.markPlayed, { callbackId }));
    this.residentSpoke = true;
    await this.finish(true);
  }

  // answered: true or false when we end the call; null when Twilio or the caller ended it.
  async finish(answered: boolean | null) {
    if (this.ended) return;
    this.ended = true;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.unsubscribe?.();
    this.transcriber?.close();
    this.speech.close();
    liveByCallSid.delete(this.callSid);
    if (this.householdId && liveByHousehold.get(this.householdId) === this) liveByHousehold.delete(this.householdId);
    if (answered !== null) await hangUp(this.callSid);
    const wasAnswered = answered ?? this.residentSpoke;
    if (wasAnswered) this.conversation?.lineClosed?.();
    if (this.callId) fireAndForget("calls.end", convex().mutation(api.calls.end, { callId: this.callId, answered: wasAnswered }));
    const { mode, callbackId, householdId, planId, role, purpose } = this.params;
    callEnded({ mode, callId: this.callId ?? undefined, callbackId, householdId, planId, role, purpose, answered: wasAnswered });
  }
}

