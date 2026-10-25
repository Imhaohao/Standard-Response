import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { env } from "../env";
import type { Language } from "../agent/script";
import { Delivery, generationConfig, ROUTINE } from "./delivery";
import { isPhantom, VoiceActivity } from "./phantomSpeech";

// Cartesia carries both directions of the call. Twilio sends and expects 8 kHz μ-law, and Cartesia
// accepts and produces it directly, so audio passes through without transcoding.

const PHONE_AUDIO = { encoding: "pcm_mulaw", sample_rate: 8000 } as const;
// Seconds of silence before ink-whisper finalizes what the resident said.
const END_OF_SPEECH_SILENCE_SECS = 0.5;

// Ink-2 hears far more of a noisy phone line than ink-whisper and doesn't invent "Thank you." out
// of hiss. It takes no language setting and hears all five of these in one stream, so a resident
// who switches between them is transcribed in the language they spoke. The rest stay on
// ink-whisper, which only hears the one language it was opened in.
const INK_2_LANGUAGES = new Set<Language>(["en", "es", "ja", "fr", "hi"]);
// Rare words residents say that a bad line blurs ("bed bound", "air"). Common words stay out:
// "wheelchair" here turned "needs assistance" into "needs a wheelchair".
const KEYTERMS = ["Altadena", "evacuation", "oxygen", "bedbound", "bedridden"];

// Whisper-style models write non-speech as tags: "[cat meowing]", "(music)", "*coughs*".
const SOUND_TAGS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪/g;

// Sonic expands "ID" and "I.D." to "Idaho" as a state abbreviation; "I-D" is read as letters.
const STATE_LOOKALIKE_ID = /\bI\.D\.|\bID\b/g;

export const spokenForm = (text: string) => text.replace(STATE_LOOKALIKE_ID, "I-D");

type ErrorMessage = { type: "error"; message?: string; title?: string };
type SttMessage = { type: string; text?: string; transcript?: string; is_final?: boolean; message?: string; title?: string };
type Heard = { text: string; isFinal: boolean };

// ink-whisper (/stt/websocket) finalizes after a fixed silence and sends each stretch as its own
// transcript. Ink-2 (/stt/turns/websocket) decides when the resident is done and sends the whole
// turn so far on every update, then once more on turn.end.
type SttProtocol = { url: string; closeMessage: string; read: (message: SttMessage) => Heard | null };

function protocolFor(language: Language): SttProtocol {
  const common = {
    encoding: PHONE_AUDIO.encoding,
    sample_rate: String(PHONE_AUDIO.sample_rate),
    cartesia_version: env.cartesia.version,
  };
  if (env.cartesia.sttModel === "ink-2" && INK_2_LANGUAGES.has(language)) {
    const params = new URLSearchParams({ model: "ink-2", ...common });
    for (const term of KEYTERMS) params.append("keyterm", term);
    return { url: `wss://api.cartesia.ai/stt/turns/websocket?${params}`, closeMessage: JSON.stringify({ type: "close" }), read: readTurn };
  }
  const params = new URLSearchParams({
    model: "ink-whisper",
    ...common,
    language,
    max_silence_duration_secs: String(END_OF_SPEECH_SILENCE_SECS),
  });
  return { url: `wss://api.cartesia.ai/stt/websocket?${params}`, closeMessage: "close", read: readTranscript };
}

function readTranscript(message: SttMessage): Heard | null {
  return message.type === "transcript" ? { text: message.text ?? "", isFinal: message.is_final === true } : null;
}

function readTurn(message: SttMessage): Heard | null {
  if (message.type === "turn.update") return { text: message.transcript ?? "", isFinal: false };
  if (message.type === "turn.end") return { text: message.transcript ?? "", isFinal: true };
  return null;
}

export type TranscriberEvents = {
  // voicedMs: how much of the audio behind this transcript was someone speaking.
  onSpeech: (text: string, isFinal: boolean, voicedMs: number) => void;
  onError: (message: string) => void;
};

export class Transcriber {
  private socket: WebSocket;
  private pending: Buffer[] = [];
  private readonly voice = new VoiceActivity();
  private readonly protocol: SttProtocol;

  constructor(language: Language, private readonly events: TranscriberEvents) {
    this.protocol = protocolFor(language);
    this.socket = new WebSocket(this.protocol.url, {
      headers: { "X-API-Key": env.cartesia.apiKey() },
    });
    this.socket.on("open", () => {
      for (const chunk of this.pending) this.socket.send(chunk);
      this.pending = [];
    });
    this.socket.on("message", (data, isBinary) => {
      if (!isBinary) this.handle(data.toString());
    });
    this.socket.on("error", (error) => this.events.onError(`stt socket: ${error.message}`));
  }

  private handle(raw: string) {
    const message = JSON.parse(raw) as SttMessage;
    if (message.type === "error") return this.events.onError(`stt: ${message.title ?? ""} ${message.message ?? ""}`);
    const heard = this.protocol.read(message);
    if (heard) this.hear(heard);
  }

  private hear({ text, isFinal }: Heard) {
    const speech = text.replace(SOUND_TAGS, " ").replace(/\s+/g, " ");
    const { voicedMs } = this.voice;
    const phantom = isPhantom(speech, voicedMs);
    if (phantom) console.log(`[stt] dropped "${speech.trim()}": ${voicedMs}ms of voice behind it`);
    if (isFinal) this.voice.reset();
    if (!phantom && speech.trim() !== "") this.events.onSpeech(speech, isFinal, voicedMs);
  }

  send(mulaw: Buffer) {
    this.voice.hear(mulaw);
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(mulaw);
    else if (this.socket.readyState === WebSocket.CONNECTING) this.pending.push(mulaw);
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(this.protocol.closeMessage);
    setTimeout(() => this.socket.terminate(), 1000);
  }
}

type ChunkMessage = { type: "chunk"; data: string; context_id: string };
type DoneMessage = { type: "done"; context_id: string };

type Utterance = { onAudio: (base64: string) => void; resolve: () => void; reject: (error: Error) => void };

// What Speaker needs from its socket. Tests pass a fake.
export type SpeakerSocket = Pick<WebSocket, "once" | "on" | "send" | "readyState" | "close">;

function openTtsSocket(): SpeakerSocket {
  const params = new URLSearchParams({ cartesia_version: env.cartesia.version });
  return new WebSocket(`wss://api.cartesia.ai/tts/websocket?${params}`, {
    headers: { "X-API-Key": env.cartesia.apiKey() },
  });
}

// One socket per call. Each sentence is its own context, so a barge-in can cancel the rest.
export class Speaker {
  private ready: Promise<void>;
  private utterances = new Map<string, Utterance>();

  constructor(private readonly socket: SpeakerSocket = openTtsSocket()) {
    this.ready = new Promise((resolve, reject) => {
      this.socket.once("open", () => resolve());
      this.socket.once("error", reject);
    });
    this.socket.on("message", (data) => this.handle(data.toString()));
    this.socket.on("error", (error) => console.error("[tts] socket error", error.message));
  }

  private handle(raw: string) {
    const message = JSON.parse(raw) as ChunkMessage | DoneMessage | (ErrorMessage & { context_id?: string });
    const utterance = message.context_id ? this.utterances.get(message.context_id) : undefined;
    if (!utterance) return;
    if (message.type === "chunk") utterance.onAudio((message as ChunkMessage).data);
    else if (message.type === "done") this.finish(message.context_id, utterance);
    else if (message.type === "error") {
      this.utterances.delete(message.context_id!);
      utterance.reject(new Error(`tts: ${(message as ErrorMessage).message ?? "error"}`));
    }
  }

  private finish(contextId: string, utterance: Utterance) {
    this.utterances.delete(contextId);
    utterance.resolve();
  }

  // Streams one sentence. Resolves once Cartesia has sent all of its audio. generation_config is
  // request-scoped in Sonic, so every request carries its delivery, routine-calm by default.
  async speak(text: string, language: Language, onAudio: (base64: string) => void, delivery: Delivery = ROUTINE) {
    await this.ready;
    const contextId: string = randomUUID();
    const done = new Promise<void>((resolve, reject) => this.utterances.set(contextId, { onAudio, resolve, reject }));
    this.socket.send(
      JSON.stringify({
        model_id: env.cartesia.ttsModel,
        transcript: spokenForm(text),
        voice: { id: env.cartesia.voiceFor(language) },
        language,
        context_id: contextId,
        output_format: { container: "raw", ...PHONE_AUDIO },
        generation_config: generationConfig(delivery, language),
        continue: false,
      }),
    );
    return { contextId, done };
  }

  cancel(contextId: string) {
    const utterance = this.utterances.get(contextId);
    if (!utterance) return;
    this.utterances.delete(contextId);
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ context_id: contextId, cancel: true }));
    utterance.resolve();
  }

  close() {
    for (const contextId of [...this.utterances.keys()]) this.cancel(contextId);
    this.socket.close();
  }
}
