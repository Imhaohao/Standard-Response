import type WebSocket from "ws";
import type { Language } from "../agent/script";
import { Speaker } from "./cartesia";

// The agent's mouth on one Twilio call. Sentences play in order; each is sent to Cartesia only
// after the previous one finished generating, so a status change can cut in at a sentence boundary
// and a barge-in can drop everything not yet heard.

type Queued = { text: string; language: Language; onStart?: () => void };

// What CallSpeech needs from a text-to-speech engine. Tests pass a fake.
export type SpeechEngine = Pick<Speaker, "speak" | "cancel" | "close">;

export type TwilioSink = Pick<WebSocket, "send" | "readyState" | "OPEN">;

export class CallSpeech {
  private queue: Queued[] = [];
  private current: string | null = null;
  private marksOutstanding = 0;
  private markCounter = 0;
  private draining = false;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly twilio: TwilioSink,
    private readonly streamSid: string,
    private readonly speaker: SpeechEngine = new Speaker(),
  ) {}

  // True from the first queued sentence until Twilio reports the last one has played.
  get speaking() {
    return this.queue.length > 0 || this.current !== null || this.marksOutstanding > 0;
  }

  say(sentences: string[], language: Language, onFirstAudio?: () => void) {
    sentences.forEach((text, index) => this.queue.push({ text, language, onStart: index === 0 ? onFirstAudio : undefined }));
    void this.drain();
  }

  // A status update: finish the sentence that's playing, drop the rest, then say this.
  cutIn(sentences: string[], language: Language) {
    this.queue = [];
    this.say(sentences, language);
  }

  // The resident started talking: stop audio now and forget anything unsaid.
  bargeIn() {
    this.queue = [];
    const cancelled = this.current;
    this.current = null;
    if (cancelled) this.speaker.cancel(cancelled);
    this.send({ event: "clear", streamSid: this.streamSid });
    this.marksOutstanding = 0;
    this.notifyIfIdle();
  }

  // Twilio echoes each mark once the audio before it has played.
  markPlayed() {
    this.marksOutstanding = Math.max(0, this.marksOutstanding - 1);
    this.notifyIfIdle();
  }

  whenSilent(): Promise<void> {
    if (!this.speaking) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  close() {
    this.queue = [];
    this.speaker.close();
    this.notifyIfIdle();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) await this.play(this.queue.shift()!);
    } finally {
      this.draining = false;
      this.notifyIfIdle();
    }
  }

  private async play(item: Queued) {
    let started = false;
    const { contextId, done } = await this.speaker.speak(item.text, item.language, (audio) => {
      if (!started) {
        started = true;
        item.onStart?.();
      }
      this.send({ event: "media", streamSid: this.streamSid, media: { payload: audio } });
    });
    this.current = contextId;
    try {
      await done;
    } catch (error) {
      console.error("[speech] sentence failed", error);
    }
    if (this.current !== contextId) return;
    this.current = null;
    this.markCounter += 1;
    this.marksOutstanding += 1;
    this.send({ event: "mark", streamSid: this.streamSid, mark: { name: `s${this.markCounter}` } });
  }

  private notifyIfIdle() {
    if (this.speaking) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private send(message: object) {
    if (this.twilio.readyState === this.twilio.OPEN) this.twilio.send(JSON.stringify(message));
  }
}
