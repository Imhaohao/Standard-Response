import type { Language } from "../agent/script";
import type { StreamParameters } from "./callParameters";
import type { Delivery } from "./delivery";

// The phone line one call runs on. CallSession talks only to this, so the same conversation runs
// over Twilio (our own audio loop: Cartesia speech-to-text and voice on raw call audio) or over
// Cartesia's telephony (Cartesia hears and speaks; text crosses the line both ways).

export interface CallVoice {
  // True from the moment something is sent to be said until the resident has heard all of it.
  readonly speaking: boolean;
  say(sentences: string[], language: Language, onFirstAudio?: () => void, delivery?: Delivery): void;
  // A status update: let the current turn finish, drop anything queued after it, then say this.
  cutIn(sentences: string[], language: Language, delivery?: Delivery): void;
  // The resident started talking: stop now and forget anything unsaid.
  bargeIn(): void;
  whenSilent(): Promise<void>;
}

export type Hearing = {
  onSpeech(text: string, isFinal: boolean, voicedMs: number): void;
  // The carrier decided the resident finished their turn. Without it, CallSession waits out its own gap.
  onTurnEnd?(): void;
  onError(message: string): void;
};

export interface CallLine {
  readonly callSid: string;
  readonly params: StreamParameters;
  readonly voice: CallVoice;
  // Starts hearing the resident in this language, replacing any earlier listener.
  listen(language: Language, hearing: Hearing): void;
  hangUp(): Promise<void>;
  // Puts the resident through to another phone; our side of the call ends there.
  connectTo(phone: string): Promise<void>;
  close(): void;
}
