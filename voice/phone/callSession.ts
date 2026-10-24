import type WebSocket from "ws";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AgentTurn, Conversation, ConversationEffects } from "../agent/conversation";
import { AgentRecord, FIELDS } from "../agent/record";
import { Language, languageOf, LINES, RideStatus } from "../agent/script";
import { convex, fireAndForget, logSubscriptionError } from "../convex";
import { Transcriber } from "./cartesia";
import { callbackScripts, callEnded, LiveCall, liveByCallSid, liveByHousehold } from "./registry";
import { CallSpeech } from "./speech";
import { hangUp, StreamParameters } from "./twilio";

// One live phone call: Twilio audio in, Cartesia speech-to-text, the conversation, Cartesia voice out.

// Silence after a finalized transcript before we treat the resident's turn as over.
const TURN_GAP_MS = 250;
// If Claude hasn't answered by then, a short backchannel covers the wait.
const BACKCHANNEL_AFTER_MS = 300;
const BARGE_IN_MIN_WORDS = 2;
// Quiet between the old-language agent's "let me transfer you" and the new one coming on.
const TRANSFER_PAUSE_MS = 1500;
// A resident on hold who says nothing for this long has likely left the phone; we say goodbye
// and hang up, and status changes reach them by callback instead.
const HOLD_SILENCE_MS = 3 * 60_000;


type TwilioStart = { streamSid: string; callSid: string; customParameters: StreamParameters };
type TwilioMessage =
  | { event: "start"; start: TwilioStart }
  | { event: "media"; media: { payload: string; track?: string } }
  | { event: "mark"; mark: { name: string } }
  | { event: "stop" }
  | { event: "connected" };

type TurnTiming = { spokeAt: number; heardAt: () => number | null };

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function handleMediaStream(socket: WebSocket) {
  let session: CallSession | null = null;
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as TwilioMessage;
    if (message.event === "start") {
      session = new CallSession(socket, message.start);
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
  private conversation: Conversation | null = null;
  private callId: Id<"calls"> | null = null;
  private language: Language = "en";
  private ride: RideStatus = null;
  private unsubscribe: (() => void) | null = null;
  private heardSoFar = "";
  private lastSpeechAt = 0;
  private turnTimer: NodeJS.Timeout | null = null;
  private holdTimer: NodeJS.Timeout | null = null;
  private thinking = false;
  private residentSpoke = false;
  private lastBackchannel = "";
  private reachedMachine = false;
  private ended = false;

  constructor(socket: WebSocket, start: TwilioStart) {
    this.params = start.customParameters;
    this.callSid = start.callSid;
    this.speech = new CallSpeech(socket, start.streamSid);
    liveByCallSid.set(this.callSid, this);
  }

  async begin() {
    if (this.params.mode === "callback") return this.beginCallback();
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

  private async resolveHousehold(): Promise<Id<"households">> {
    if (this.params.mode === "survey") {
      this.callId = this.params.callId as Id<"calls">;
      return this.params.householdId as Id<"households">;
    }
    const householdId = await convex().mutation(api.households.findOrCreateByPhone, { callbackNumber: this.params.from ?? "unknown" });
    this.callId = await convex().mutation(api.calls.start, { householdId, direction: "inbound" });
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
      onSpeech: (text, isFinal) => this.onSpeech(text, isFinal),
      onError: (message) => console.error(`[call ${this.callSid}] ${message}`),
    });
  }

  hearAudio(base64: string) {
    this.transcriber?.send(Buffer.from(base64, "base64"));
  }

  markPlayed() {
    this.speech.markPlayed();
  }

  private onSpeech(text: string, isFinal: boolean) {
    this.lastSpeechAt = Date.now();
    this.clearHoldTimer();
    if (this.speech.speaking && (isFinal || wordCount(text) >= BARGE_IN_MIN_WORDS)) this.speech.bargeIn();
    if (isFinal) this.heardSoFar += text;
    if (this.heardSoFar.trim() === "") return;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = setTimeout(() => void this.takeTurn(), TURN_GAP_MS);
  }

  private async takeTurn() {
    if (this.thinking || !this.conversation || this.conversation.done) return;
    const utterance = this.heardSoFar.trim();
    this.heardSoFar = "";
    if (utterance === "") return;
    this.thinking = true;
    this.residentSpoke = true;
    const spokeAt = this.lastSpeechAt;
    this.logLine("resident", utterance);
    // First audio the resident hears after they stop, whether the backchannel or the reply itself.
    let heardAt: number | null = null;
    let backchanneled = false;
    const backchannel = setTimeout(() => {
      backchanneled = true;
      this.speech.say([this.pickBackchannel()], this.language, () => {
        heardAt = Date.now();
        this.logLatency(spokeAt, "backchannel");
      });
    }, BACKCHANNEL_AFTER_MS);
    try {
      const turn = await this.conversation.hear(utterance);
      clearTimeout(backchannel);
      this.syncLanguage();
      if (turn.ignored) this.afterNoise(backchanneled);
      else if (turn.transfer) void this.speakTransfer(turn, { spokeAt, heardAt: () => heardAt }, turn.transfer);
      else this.speakTurn(turn, { spokeAt, heardAt: () => heardAt }, backchanneled);
    } finally {
      this.thinking = false;
      if (this.heardSoFar.trim() !== "") void this.takeTurn();
    }
  }

  // A language switch plays as a transfer: the old voice signs off, a pause, then the new voice.
  private async speakTransfer(turn: AgentTurn, timing: TurnTiming, transfer: NonNullable<AgentTurn["transfer"]>) {
    this.speech.say([transfer.line], transfer.language, () => this.logLine("agent", transfer.line, Date.now() - timing.spokeAt));
    await this.speech.whenSilent();
    await new Promise((resolve) => setTimeout(resolve, TRANSFER_PAUSE_MS));
    if (!this.ended) this.speakTurn(turn, null);
  }

  private speakTurn(turn: AgentTurn, timing: TurnTiming | null, dropAcknowledgment = false) {
    const sentences = [dropAcknowledgment ? "" : turn.acknowledgment, ...turn.sentences].filter((line) => line !== "");
    const text = sentences.join(" ");
    this.speech.say(sentences, this.language, () => {
      const firstAudio = timing?.heardAt() ?? Date.now();
      this.logLine("agent", text, timing ? firstAudio - timing.spokeAt : undefined);
    });
    if (this.callId) fireAndForget("setStage", convex().mutation(api.calls.setStage, { callId: this.callId, stage: turn.stage }));
    if (turn.done) void this.speech.whenSilent().then(() => this.finish(true));
    else if (this.conversation?.holding) void this.speech.whenSilent().then(() => this.armHoldTimer());
  }

  private armHoldTimer() {
    this.clearHoldTimer();
    this.holdTimer = setTimeout(() => {
      if (this.ended || this.thinking || !this.conversation?.holding) return;
      this.speakTurn(this.conversation.endHold(), null);
    }, HOLD_SILENCE_MS);
  }

  private clearHoldTimer() {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private logLatency(spokeAt: number, label: string) {
    console.log(`[call ${this.callSid}] first audio (${label}) ${Date.now() - spokeAt}ms after the resident stopped`);
  }

  // Noise stays unanswered, unless a backchannel already played: then the question is asked again
  // so the "Mm-hm" doesn't hang in the air.
  private afterNoise(backchanneled: boolean) {
    if (!backchanneled || !this.conversation) return;
    this.speech.say([this.conversation.question()], this.language);
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
    await this.speech.whenSilent();
    if (this.conversation.holding) this.armHoldTimer();
  }

  onMachine() {
    if (this.residentSpoke || this.ended) return;
    this.reachedMachine = true;
    this.speech.bargeIn();
    const voicemail = this.params.mode === "callback" ? this.callbackSentences() : [LINES[this.language].voicemail];
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
    this.clearHoldTimer();
    this.unsubscribe?.();
    this.transcriber?.close();
    this.speech.close();
    liveByCallSid.delete(this.callSid);
    if (this.householdId && liveByHousehold.get(this.householdId) === this) liveByHousehold.delete(this.householdId);
    if (answered !== null) await hangUp(this.callSid);
    const wasAnswered = answered ?? this.residentSpoke;
    if (this.callId) fireAndForget("calls.end", convex().mutation(api.calls.end, { callId: this.callId, answered: wasAnswered }));
    callEnded({ mode: this.params.mode, callId: this.callId ?? undefined, callbackId: this.params.callbackId, answered: wasAnswered });
  }
}

// What the agency already has on file for this home, so the agent confirms instead of asking cold.
function onFileRecord(household: Record<string, unknown>): AgentRecord {
  const record: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (field !== "address" && household[field] !== undefined) record[field] = household[field];
  }
  return record as AgentRecord;
}
