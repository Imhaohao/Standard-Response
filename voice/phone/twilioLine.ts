import type WebSocket from "ws";
import type { Language } from "../agent/script";
import type { StreamParameters } from "./callParameters";
import { transcribeClip, Transcriber, unheardLanguages } from "./cartesia";
import type { Rehearing } from "../agent/interpreter";
import type { CallLine, Hearing } from "./line";
import { CallSpeech } from "./speech";
import { TurnAudio } from "./turnAudio";
import { connectTo, hangUp } from "./twilio";

// A call on Twilio Media Streams: raw μ-law audio both ways, Cartesia speech-to-text and voice on it.

export type TwilioStart = { streamSid: string; callSid: string; customParameters: StreamParameters };

export class TwilioLine implements CallLine {
  readonly callSid: string;
  readonly params: StreamParameters;
  readonly voice: CallSpeech;
  readonly fillsPauses = true;
  private transcriber: Transcriber | null = null;
  private language: Language = "en";
  private readonly turnAudio = new TurnAudio();

  constructor(socket: WebSocket, start: TwilioStart) {
    this.callSid = start.callSid;
    this.params = start.customParameters;
    this.voice = new CallSpeech(socket, start.streamSid);
  }

  hearAudio(base64: string) {
    const audio = Buffer.from(base64, "base64");
    this.turnAudio.hear(audio);
    this.transcriber?.send(audio);
  }

  markPlayed() {
    this.voice.markPlayed();
  }

  listen(language: Language, hearing: Hearing) {
    this.language = language;
    this.transcriber?.close();
    this.transcriber = new Transcriber(language, { onSpeech: hearing.onSpeech, onError: hearing.onError });
  }

  // A language that fails to transcribe is left out; the turn is read from the others.
  async rehear(): Promise<Rehearing[]> {
    const clip = this.turnAudio.clip();
    if (!clip) return [];
    const heard = await Promise.all(
      unheardLanguages(this.language).map((language) =>
        transcribeClip(clip, language)
          .then((text) => ({ language, text }))
          .catch((error: unknown) => {
            console.error(`[call ${this.callSid}] ${error instanceof Error ? error.message : String(error)}`);
            return { language, text: "" };
          }),
      ),
    );
    return heard.filter((rehearing) => rehearing.text !== "");
  }

  nextTurn() {
    this.turnAudio.reset();
  }

  hangUp() {
    return hangUp(this.callSid);
  }

  connectTo(phone: string) {
    return connectTo(this.callSid, phone);
  }

  close() {
    this.transcriber?.close();
    this.voice.close();
  }
}
