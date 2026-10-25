import type { Language } from "../agent/script";
import { env } from "../env";
import type { StreamParameters } from "./callParameters";
import { spokenForm } from "./cartesia";
import type { CallLine, CallVoice, Hearing } from "./line";

// A call on Cartesia's telephony (VOICE_CARRIER=cartesia). Cartesia answers the phone, hears the
// resident and speaks; this server still decides every word. Both sides exchange text over the
// self-hosted agent socket, in the Line SDK's wire format (cartesia-ai/line, line/_harness_types.py).

export type CartesiaInput =
  | { type: "message"; content: string }
  | { type: "user_state"; value: "speaking" | "idle" }
  | { type: "agent_state"; value: "speaking" | "idle" }
  | { type: string; [key: string]: unknown };

type Send = (message: object) => void;
export type SocketSink = { send(data: string): void; readyState: number; readonly OPEN: number };

// Cartesia heard the audio itself, so a transcript it sends is real speech, never a click or hiss:
// it counts as long enough to stop the agent under interruption.ts.
const HEARD_MS = 1000;
// A message Cartesia never reports speaking (an empty or rejected one) stops counting after this.
const START_GRACE_MS = 5000;
// An agent "idle" this soon after a message was sent is the end of the previous message, not this one.
const FRESH_MESSAGE_MS = 300;
// Cartesia ends a turn at every short pause, so room talk arrives as scraps a second apart. A turn
// waits this long for more before it is answered, and the scraps are read together.
const TURN_SETTLE_MS = 400;
// A message sent right behind a voice change went unspoken on a live call (the greeting, 2026-10-24),
// so messages wait this long after one.
const VOICE_SETTLE_MS = 500;
const NO_SPACE_BETWEEN_SENTENCES = new Set<Language>(["zh", "ja"]);

export type CartesiaTiming = { turnSettleMs: number; voiceSettleMs: number };
const LIVE_TIMING: CartesiaTiming = { turnSettleMs: TURN_SETTLE_MS, voiceSettleMs: VOICE_SETTLE_MS };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The agent's mouth on a Cartesia call. Cartesia queues and voices each message; agent_state says
// when the resident is hearing it. Cartesia already stops the voice when the resident talks over it.
export class CartesiaVoice implements CallVoice {
  private agentSpeaking = false;
  private sentAt: number | null = null;
  private idleWaiters: (() => void)[] = [];
  // Messages leave in order; each waits for any voice change before it.
  private outbox: Promise<void> = Promise.resolve();
  private quietUntil = 0;

  constructor(private readonly send: Send, private readonly useVoice: (language: Language) => void) {}

  get speaking() {
    return this.agentSpeaking || (this.sentAt !== null && Date.now() - this.sentAt < START_GRACE_MS);
  }

  // Holds the next messages back while Cartesia switches voice.
  holdFor(ms: number) {
    this.quietUntil = Math.max(this.quietUntil, Date.now() + ms);
  }

  // Urgency (delivery.ts) has no place on this wire: Cartesia voices every message the same way.
  say(sentences: string[], language: Language, onFirstAudio?: () => void) {
    const text = sentences.filter((sentence) => sentence !== "").join(NO_SPACE_BETWEEN_SENTENCES.has(language) ? "" : " ");
    if (text === "") return;
    this.sentAt = Date.now();
    this.outbox = this.outbox.then(async () => {
      this.useVoice(language);
      await wait(this.quietUntil - Date.now());
      this.send({ type: "message", content: spokenForm(text), interruptible: true });
      this.send({ type: "response_end" });
      this.sentAt = Date.now();
      onFirstAudio?.();
      setTimeout(() => this.notifyIfIdle(), START_GRACE_MS);
    });
  }

  // Cartesia can't drop what it already queued, so a status update simply follows the current turn.
  cutIn(sentences: string[], language: Language) {
    this.say(sentences, language);
  }

  bargeIn() {
    this.sentAt = null;
    this.agentSpeaking = false;
    this.notifyIfIdle();
  }

  agentState(value: unknown) {
    if (value === "speaking") {
      this.agentSpeaking = true;
      this.sentAt = null;
      return;
    }
    this.agentSpeaking = false;
    if (this.sentAt !== null && Date.now() - this.sentAt > FRESH_MESSAGE_MS) this.sentAt = null;
    this.notifyIfIdle();
  }

  // Resolves once everything handed to say() has gone out on the socket.
  sent() {
    return this.outbox;
  }

  whenSilent(): Promise<void> {
    if (!this.speaking) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  close() {
    this.bargeIn();
  }

  private notifyIfIdle() {
    if (this.speaking) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

export class CartesiaLine implements CallLine {
  readonly voice: CartesiaVoice;
  // Cartesia's endpointing ends turns on room talk too, so a filler before Claude has read the words
  // was said to every scrap of it.
  readonly fillsPauses = false;
  private hearing: Hearing | null = null;
  private voiceLanguage: Language | null = null;
  private residentTalking = false;
  private heardThisTurn = false;
  private turnEnd: NodeJS.Timeout | null = null;

  constructor(
    private readonly socket: SocketSink,
    readonly callSid: string,
    readonly params: StreamParameters,
    private readonly voiceFor: (language: Language) => string = env.cartesia.voiceFor,
    private readonly timing: CartesiaTiming = LIVE_TIMING,
  ) {
    this.voice = new CartesiaVoice((message) => this.send(message), (language) => this.useVoice(language));
  }

  listen(language: Language, hearing: Hearing) {
    this.hearing = hearing;
    this.send({ type: "config", stt: { language }, language });
    this.useVoice(language);
  }

  // A transcript and the end of the resident's turn can arrive in either order; the turn ends once
  // both have and nothing more follows for a moment.
  receive(message: CartesiaInput) {
    if (message.type === "message" && typeof message.content === "string") return this.heard(message.content);
    if (message.type === "user_state") return this.residentState(message.value);
    if (message.type === "agent_state") return this.voice.agentState(message.value);
    if (message.type === "validation_error" || message.type === "error") console.error(`[call ${this.callSid}] Cartesia: ${JSON.stringify(message)}`);
  }

  async hangUp() {
    await this.voice.sent();
    this.send({ type: "end_call" });
  }

  async connectTo(phone: string) {
    await this.voice.sent();
    this.send({ type: "transfer", transfer_destination: { type: "phone", value: phone }, interruptible: false });
  }

  close() {
    if (this.turnEnd) clearTimeout(this.turnEnd);
    this.voice.close();
  }

  private heard(text: string) {
    this.heardThisTurn = true;
    this.hearing?.onSpeech(text, true, HEARD_MS);
    if (!this.residentTalking) this.settleTurn();
  }

  private residentState(value: unknown) {
    this.residentTalking = value === "speaking";
    if (this.residentTalking) {
      this.heardThisTurn = false;
      if (this.turnEnd) clearTimeout(this.turnEnd);
      this.turnEnd = null;
      return;
    }
    if (this.heardThisTurn) this.settleTurn();
  }

  private settleTurn() {
    if (this.turnEnd) clearTimeout(this.turnEnd);
    this.turnEnd = setTimeout(() => {
      this.turnEnd = null;
      this.hearing?.onTurnEnd?.();
    }, this.timing.turnSettleMs);
  }

  private useVoice(language: Language) {
    if (language === this.voiceLanguage) return;
    this.voiceLanguage = language;
    this.send({ type: "config", tts: { voice_id: this.voiceFor(language), language } });
    this.voice.holdFor(this.timing.voiceSettleMs);
  }

  private send(message: object) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
