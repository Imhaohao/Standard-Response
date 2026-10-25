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
const NO_SPACE_BETWEEN_SENTENCES = new Set<Language>(["zh", "ja"]);

// The agent's mouth on a Cartesia call. Cartesia queues and voices each message; agent_state says
// when the resident is hearing it. Cartesia already stops the voice when the resident talks over it.
export class CartesiaVoice implements CallVoice {
  private agentSpeaking = false;
  private sentAt: number | null = null;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly send: Send, private readonly useVoice: (language: Language) => void) {}

  get speaking() {
    return this.agentSpeaking || (this.sentAt !== null && Date.now() - this.sentAt < START_GRACE_MS);
  }

  // Urgency (delivery.ts) has no place on this wire: Cartesia voices every message the same way.
  say(sentences: string[], language: Language, onFirstAudio?: () => void) {
    const text = sentences.filter((sentence) => sentence !== "").join(NO_SPACE_BETWEEN_SENTENCES.has(language) ? "" : " ");
    if (text === "") return;
    this.useVoice(language);
    this.send({ type: "message", content: spokenForm(text), interruptible: true });
    this.send({ type: "response_end" });
    this.sentAt = Date.now();
    onFirstAudio?.();
    setTimeout(() => this.notifyIfIdle(), START_GRACE_MS);
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
  private hearing: Hearing | null = null;
  private voiceLanguage: Language | null = null;
  private residentTalking = false;
  private heardThisTurn = false;

  constructor(
    private readonly socket: SocketSink,
    readonly callSid: string,
    readonly params: StreamParameters,
    private readonly voiceFor: (language: Language) => string = env.cartesia.voiceFor,
  ) {
    this.voice = new CartesiaVoice((message) => this.send(message), (language) => this.useVoice(language));
  }

  listen(language: Language, hearing: Hearing) {
    this.hearing = hearing;
    this.send({ type: "config", stt: { language }, language });
    this.useVoice(language);
  }

  // A transcript and the end of the resident's turn can arrive in either order; the turn ends once both have.
  receive(message: CartesiaInput) {
    if (message.type === "message" && typeof message.content === "string") return this.heard(message.content);
    if (message.type === "user_state") return this.residentState(message.value);
    if (message.type === "agent_state") this.voice.agentState(message.value);
  }

  async hangUp() {
    this.send({ type: "end_call" });
  }

  async connectTo(phone: string) {
    this.send({ type: "transfer", transfer_destination: { type: "phone", value: phone }, interruptible: false });
  }

  close() {
    this.voice.close();
  }

  private heard(text: string) {
    this.heardThisTurn = true;
    this.hearing?.onSpeech(text, true, HEARD_MS);
    if (!this.residentTalking) this.hearing?.onTurnEnd?.();
  }

  private residentState(value: unknown) {
    this.residentTalking = value === "speaking";
    if (this.residentTalking) {
      this.heardThisTurn = false;
      return;
    }
    if (this.heardThisTurn) this.hearing?.onTurnEnd?.();
  }

  private useVoice(language: Language) {
    if (language === this.voiceLanguage) return;
    this.voiceLanguage = language;
    this.send({ type: "config", tts: { voice_id: this.voiceFor(language), language } });
  }

  private send(message: object) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
