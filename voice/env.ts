// Every setting the voice server reads. Secrets come from the shared env file (.env.local), never git.

import { isFictionalNumber } from "../lib/phone-number";
import { onWarningCallList } from "../lib/warning-call-list";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to .env.local (see "Voice server" in README.md)`);
  return value;
}

const optional = (name: string, fallback: string) => process.env[name] || fallback;

const numberFrom = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && process.env[name] !== "" ? parsed : fallback;
};

const listFrom = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

// Cartesia stock voices native to each call language, picked for a calm, clear delivery on a phone
// line. CARTESIA_VOICE_<CODE> overrides any of them.
const NATIVE_VOICES: Record<string, string> = {
  zh: "0f5ac064-30c7-4cf6-8748-d275f682a0d5", // Yu-Hsin
  ko: "1a602be4-3b57-4bef-a270-dfa5efed0541", // Yeji
  vi: "8e8f222d-c817-4cc5-822b-8bf76ca7e98d", // Lien
  tl: "6d14ac2a-4dda-46f8-bd6f-0722db08ec00", // Mae
  ru: "7a62541e-5492-410e-95ff-3abd096fce87", // Natalia
  ja: "498e7f37-7fa3-4e2c-b8e2-8b6e9276f956", // Aiko
  fr: "92579402-6868-412e-b845-3efed0be7a9e", // Jade
  hi: "6b02ffe5-e3cb-48c0-a023-c72f85953375", // Sneha
};

export const env = {
  port: numberFrom("PORT", 8080),
  convexUrl: () => process.env.CONVEX_URL || required("NEXT_PUBLIC_CONVEX_URL"),
  // Public https base of this server, e.g. https://rollcall-voice.fly.dev. Twilio calls back here.
  publicUrl: () => required("VOICE_PUBLIC_URL").replace(/\/$/, ""),
  // Haiku answers as fast as Opus fast mode on the voice exam's turns at a fraction of the cost.
  // VOICE_MODEL=claude-opus-5-5 runs Opus in fast mode, which scored higher on conduct.
  anthropicModel: optional("VOICE_MODEL", "claude-haiku-5-5"),
  // Extraction is a lookup, not reasoning; thinking only adds latency on a phone turn.
  anthropicThinkingOff: optional("VOICE_THINKING", "off") === "off",
  // Moss semantic search over the principles and the 911 dialog bank (voice/knowledge). Without keys,
  // or with VOICE_KNOWLEDGE=off, Claude reads each turn without it.
  moss: {
    projectId: process.env.MOSS_PROJECT_ID ?? "",
    projectKey: process.env.MOSS_PROJECT_KEY ?? "",
    enabled: optional("VOICE_KNOWLEDGE", "on") === "on",
    // Approved answers (voice/agent/answerLookup.ts): the relevance floor from 0 to 1. Below it the
    // agent says it doesn't know rather than guess.
    answerMinScore: numberFrom("MOSS_MIN_SCORE", 0.7),
  },
  // Backup model on Bitdeer AI Model Studio (voice/agent/fallbackModel.ts). Read at call time. Without
  // BITDEER_API_KEY the backup is off and a Claude outage behaves as it always did.
  bitdeer: {
    apiKey: () => process.env.BITDEER_API_KEY ?? "",
    model: () => optional("BITDEER_MODEL", "Qwen/Qwen3.8-27B"),
    baseUrl: () => optional("BITDEER_BASE_URL", "https://api-inference.bitdeer.ai/v1").replace(/\/$/, ""),
    // A Claude request slower than this also goes to Bitdeer; whichever answers first is used.
    fallbackAfterMs: () => numberFrom("FALLBACK_AFTER_MS", 4000),
  },
  twilio: {
    accountSid: () => required("TWILIO_ACCOUNT_SID"),
    // REST calls authenticate with an API key; the auth token only checks webhook signatures.
    apiKeySid: () => required("TWILIO_API_KEY_SID"),
    apiKeySecret: () => required("TWILIO_API_KEY_SECRET"),
    authToken: () => required("TWILIO_AUTH_TOKEN"),
    fromNumber: () => required("TWILIO_FROM_NUMBER"),
  },
  cartesia: {
    apiKey: () => required("CARTESIA_API_KEY"),
    version: optional("CARTESIA_VERSION", "2026-08-14"),
    // "ink-whisper" puts every language back on the older model.
    sttModel: optional("CARTESIA_STT_MODEL", "ink-2"),
    ttsModel: optional("CARTESIA_TTS_MODEL", "sonic-latest"),
    voiceEn: () => required("CARTESIA_VOICE_EN"),
    voiceEs: () => required("CARTESIA_VOICE_ES"),
    // Sonic voices speak every supported language, so other languages fall back to the English
    // voice until CARTESIA_VOICE_<CODE> (for example CARTESIA_VOICE_KO) names a native one.
    // Cartesia's telephony (VOICE_CARRIER=cartesia): the self-hosted agent that calls this server,
    // the number it dials from (its id, "ap_..."), and that number, so an inbound call is recognized.
    // The account that owns that agent and number, when it isn't the one CARTESIA_API_KEY speaks for.
    telephonyApiKey: () => process.env.CARTESIA_TELEPHONY_API_KEY || required("CARTESIA_API_KEY"),
    agentId: () => required("CARTESIA_AGENT_ID"),
    fromNumberId: () => required("CARTESIA_FROM_NUMBER_ID"),
    phoneNumber: () => required("CARTESIA_PHONE_NUMBER"),
    voiceFor: (language: string) =>
      language === "es"
        ? required("CARTESIA_VOICE_ES")
        : process.env[`CARTESIA_VOICE_${language.toUpperCase()}`] || NATIVE_VOICES[language] || required("CARTESIA_VOICE_EN"),
  },
  // Which phone system carries every call. "twilio" streams raw call audio into our own loop
  // (Cartesia speech-to-text and voice on it). "cartesia" lets Cartesia's telephony hear and speak
  // while this server still decides every word (voice/phone/cartesiaLine.ts). Twilio is the default.
  carrier: (process.env.VOICE_CARRIER === "cartesia" ? "cartesia" : "twilio") as "twilio" | "cartesia",
  // Which stack runs the household call (inbound and survey). "cartesia" is our own loop: Cartesia
  // speech-to-text, the Conversation state machine on Claude, Cartesia voice. "elevenlabs" hands the
  // whole call to an ElevenLabs Conversational AI agent (voice/phone/elevenLabsCall.ts). Callbacks,
  // pickup checks and Ready checks are scripted and always run on Cartesia. Only VOICE_STACK=elevenlabs
  // picks the ElevenLabs agent: it skips the honesty state machine, so an API key alone never does.
  voiceStack: (process.env.VOICE_STACK === "elevenlabs" ? "elevenlabs" : "cartesia") as "cartesia" | "elevenlabs",
  elevenlabs: {
    apiKey: () => required("ELEVENLABS_API_KEY"),
    voiceId: optional("ELEVENLABS_VOICE_ID", "cjVigY5qzO86Huf0OWal"),
    llm: optional("ELEVENLABS_AGENT_LLM", "gemini-2.5-flash"),
    // "patient" waits longer before deciding the resident is done; "normal" and "eager" answer sooner.
    turnEagerness: optional("ELEVENLABS_TURN_EAGERNESS", "patient"),
  },
  // Numbers the dialer may ring. "*" allows any real number. Everything else is skipped, so a
  // fictional rider list can never ring a stranger.
  dialAllowlist: listFrom("DIAL_ALLOWLIST"),
  callsPerSecond: numberFrom("DIAL_CALLS_PER_SECOND", 1),
  maxLiveCalls: numberFrom("DIAL_MAX_LIVE_CALLS", 6),
  validateTwilioSignature: optional("TWILIO_VALIDATE_SIGNATURE", "true") === "true",
  // Trial accounts play a notice and wait for a key press before our TwiML runs. Machine detection
  // would hear that notice as voicemail, so it stays off on a trial.
  twilioTrial: optional("TWILIO_TRIAL", "false") === "true",
};

// A 555 number is never dialed, even under "*": the sample riders and seeded homes use them, and a
// call to one only rings out and marks the home unanswered.
export function mayDial(phone: string) {
  if (isFictionalNumber(phone)) return false;
  return env.dialAllowlist.includes("*") || env.dialAllowlist.includes(phone);
}

// The warning's calls, its pickup checks and its callbacks ring only the team's phones
// (lib/warning-call-list.ts). The Ready check, before the warning, still follows `mayDial` alone.
export function mayDialOnWarning(phone: string) {
  return mayDial(phone) && onWarningCallList(phone);
}
