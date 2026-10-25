import { isVoiced } from "./phantomSpeech";

// What the resident said this turn, as raw call audio, so a turn that speech-to-text heard as
// nonsense can be transcribed again in other languages. It starts a little before the first voiced
// frame, since quiet before speech only gives Whisper room to invent words, and keeps the latest
// stretch Whisper can take in one go.

const MULAW_BYTES_PER_MS = 8;
const LEAD_IN_MS = 300;
const MAX_MS = 30_000;

export class TurnAudio {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private voiced = false;

  hear(chunk: Buffer) {
    this.voiced ||= isVoiced(chunk);
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    const limit = (this.voiced ? MAX_MS : LEAD_IN_MS) * MULAW_BYTES_PER_MS;
    while (this.chunks.length > 1 && this.bytes - this.chunks[0].length >= limit) {
      const [oldest] = this.chunks.splice(0, 1);
      this.bytes -= oldest.length;
    }
  }

  // Null until someone has spoken this turn.
  clip(): Buffer | null {
    return this.voiced ? Buffer.concat(this.chunks) : null;
  }

  // The turn was taken: what is heard from here on belongs to the next one.
  reset() {
    this.chunks = [];
    this.bytes = 0;
    this.voiced = false;
  }
}
