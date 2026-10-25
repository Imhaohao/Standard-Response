// Whisper-style speech-to-text invents words out of silence or line noise: "Thank you.",
// "감사합니다.", "Gracias.", or one word looped. On a call those phantom turns confirm read-backs,
// barge in on the agent and count toward hand-offs. A phantom is dropped when the audio behind it
// carried almost no voice.

// Average level of a 20 ms frame, in 16-bit sample units, above which the frame counts as voice.
// Phone line hiss sits in the low hundreds; speech is in the thousands.
const VOICE_LEVEL = 500;
// A real "thank you" or "gracias" carries at least this much voiced audio.
const MIN_VOICED_MS = 200;
const MULAW_SAMPLES_PER_MS = 8;
// One word this many times in a row, with too little voice behind it to have been said that often,
// is a decoding loop. A person saying "no, no, no, no" is kept, since that carries real voice.
const LOOP_REPEATS = 4;
const MIN_VOICED_MS_PER_WORD = 100;

const SILENCE_PHRASES = new Set([
  "thank you",
  "thanks",
  "thank you very much",
  "thank you for watching",
  "thanks for watching",
  "bye",
  "you",
  "http",
  "gracias",
  "muchas gracias",
  "감사합니다",
  "고맙습니다",
  "谢谢",
  "谢谢观看",
  "ありがとうございました",
  "ありがとうございます",
  "спасибо",
  "cảm ơn",
  "salamat",
]);

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

export function decodeMulaw(byte: number) {
  const inverted = ~byte & 0xff;
  const exponent = (inverted >> 4) & 0x07;
  const magnitude = (((inverted & 0x0f) << 3) + 0x84) << exponent;
  return inverted & 0x80 ? 0x84 - magnitude : magnitude - 0x84;
}

export function mulawLevel(chunk: Buffer) {
  if (chunk.length === 0) return 0;
  let sumOfSquares = 0;
  for (const byte of chunk) sumOfSquares += decodeMulaw(byte) ** 2;
  return Math.sqrt(sumOfSquares / chunk.length);
}

export const isVoiced = (chunk: Buffer) => mulawLevel(chunk) >= VOICE_LEVEL;

// How much of the audio since the last finished transcript was someone speaking.
export class VoiceActivity {
  voicedMs = 0;

  hear(chunk: Buffer) {
    if (isVoiced(chunk)) this.voicedMs += chunk.length / MULAW_SAMPLES_PER_MS;
  }

  reset() {
    this.voicedMs = 0;
  }
}

function isLoop(words: string[], voicedMs: number) {
  const repeated = words.length >= LOOP_REPEATS && words.every((word) => word === words[0]);
  return repeated && voicedMs < words.length * MIN_VOICED_MS_PER_WORD;
}

export function isPhantom(text: string, voicedMs: number) {
  const normalized = normalize(text);
  if (isLoop(normalized.split(" "), voicedMs)) return true;
  return SILENCE_PHRASES.has(normalized) && voicedMs < MIN_VOICED_MS;
}
