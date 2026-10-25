import type WebSocket from "ws";
import type { Language } from "../agent/script";
import type { StreamParameters } from "./callParameters";
import { Transcriber } from "./cartesia";
import type { CallLine, Hearing } from "./line";
import { CallSpeech } from "./speech";
import { connectTo, hangUp } from "./twilio";

// A call on Twilio Media Streams: raw μ-law audio both ways, Cartesia speech-to-text and voice on it.

export type TwilioStart = { streamSid: string; callSid: string; customParameters: StreamParameters };

export class TwilioLine implements CallLine {
  readonly callSid: string;
  readonly params: StreamParameters;
  readonly voice: CallSpeech;
  private transcriber: Transcriber | null = null;

  constructor(socket: WebSocket, start: TwilioStart) {
    this.callSid = start.callSid;
    this.params = start.customParameters;
    this.voice = new CallSpeech(socket, start.streamSid);
  }

  hearAudio(base64: string) {
    this.transcriber?.send(Buffer.from(base64, "base64"));
  }

  markPlayed() {
    this.voice.markPlayed();
  }

  listen(language: Language, hearing: Hearing) {
    this.transcriber?.close();
    this.transcriber = new Transcriber(language, { onSpeech: hearing.onSpeech, onError: hearing.onError });
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
