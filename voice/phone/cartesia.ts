import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { env } from "../env";
import type { Language } from "../agent/script";
import { isPhantom, VoiceActivity } from "./phantomSpeech";

// Cartesia carries both directions of the call. Twilio sends and expects 8 kHz μ-law, and Cartesia
// accepts and produces it directly, so audio passes through without transcoding.

const PHONE_AUDIO = { encoding: "pcm_mulaw", sample_rate: 8000 } as const;
// Seconds of silence before Cartesia finalizes what the resident said.
const END_OF_SPEECH_SILENCE_SECS = 0.5;

// Whisper-style models write non-speech as tags: "[cat meowing]", "(music)", "*coughs*".
const SOUND_TAGS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪/g;

type TranscriptMessage = { type: "transcript"; is_final: boolean; text: string };
type ErrorMessage = { type: "error"; message?: string; title?: string };

export type TranscriberEvents = {
  // voicedMs: how much of the audio behind this transcript was someone speaking.
  onSpeech: (text: string, isFinal: boolean, voicedMs: number) => void;
  onError: (message: string) => void;
};

export class Transcriber {
  private socket: WebSocket;
  private pending: Buffer[] = [];
  private readonly voice = new VoiceActivity();

  constructor(language: Language, private readonly events: TranscriberEvents) {
    const params = new URLSearchParams({
      model: env.cartesia.sttModel,
      encoding: PHONE_AUDIO.encoding,
      sample_rate: String(PHONE_AUDIO.sample_rate),
      cartesia_version: env.cartesia.version,
      language,
      max_silence_duration_secs: String(END_OF_SPEECH_SILENCE_SECS),
    });
    this.socket = new WebSocket(`wss://api.cartesia.ai/stt/websocket?${params}`, {
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
    const message = JSON.parse(raw) as TranscriptMessage | ErrorMessage | { type: string };
    if (message.type === "transcript") {
      const transcript = message as TranscriptMessage;
      const speech = transcript.text.replace(SOUND_TAGS, " ").replace(/\s+/g, " ");
      const { voicedMs } = this.voice;
      const phantom = isPhantom(speech, voicedMs);
      if (phantom) console.log(`[stt] dropped "${speech.trim()}": ${voicedMs}ms of voice behind it`);
      if (transcript.is_final) this.voice.reset();
      if (!phantom && speech.trim() !== "") this.events.onSpeech(speech, transcript.is_final, voicedMs);
    } else if (message.type === "error") {
      const error = message as ErrorMessage;
      this.events.onError(`stt: ${error.title ?? ""} ${error.message ?? ""}`);
    }
  }

  send(mulaw: Buffer) {
    this.voice.hear(mulaw);
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(mulaw);
    else if (this.socket.readyState === WebSocket.CONNECTING) this.pending.push(mulaw);
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send("close");
    setTimeout(() => this.socket.terminate(), 1000);
  }
}

type ChunkMessage = { type: "chunk"; data: string; context_id: string };
type DoneMessage = { type: "done"; context_id: string };

type Utterance = { onAudio: (base64: string) => void; resolve: () => void; reject: (error: Error) => void };

// One socket per call. Each sentence is its own context, so a barge-in can cancel the rest.
export class Speaker {
  private socket: WebSocket;
  private ready: Promise<void>;
  private utterances = new Map<string, Utterance>();

  constructor() {
    const params = new URLSearchParams({ cartesia_version: env.cartesia.version });
    this.socket = new WebSocket(`wss://api.cartesia.ai/tts/websocket?${params}`, {
      headers: { "X-API-Key": env.cartesia.apiKey() },
    });
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

  // Streams one sentence. Resolves once Cartesia has sent all of its audio.
  async speak(text: string, language: Language, onAudio: (base64: string) => void) {
    await this.ready;
    const contextId: string = randomUUID();
    const done = new Promise<void>((resolve, reject) => this.utterances.set(contextId, { onAudio, resolve, reject }));
    this.socket.send(
      JSON.stringify({
        model_id: env.cartesia.ttsModel,
        transcript: text,
        voice: { id: env.cartesia.voiceFor(language) },
        language,
        context_id: contextId,
        output_format: { container: "raw", ...PHONE_AUDIO },
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
