// Every setting the voice server reads. Secrets come from the shared env file (.env.local), never git.

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

export const env = {
  port: numberFrom("PORT", 8080),
  convexUrl: () => process.env.CONVEX_URL || required("NEXT_PUBLIC_CONVEX_URL"),
  // Public https base of this server, e.g. https://rollcall-voice.fly.dev. Twilio calls back here.
  publicUrl: () => required("VOICE_PUBLIC_URL").replace(/\/$/, ""),
  anthropicModel: optional("VOICE_MODEL", "claude-haiku-5-5"),
  // Extraction is a lookup, not reasoning; thinking only adds latency on a phone turn.
  anthropicThinkingOff: optional("VOICE_THINKING", "off") === "off",
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
    sttModel: optional("CARTESIA_STT_MODEL", "ink-whisper"),
    ttsModel: optional("CARTESIA_TTS_MODEL", "sonic-latest"),
    voiceEn: () => required("CARTESIA_VOICE_EN"),
    voiceEs: () => required("CARTESIA_VOICE_ES"),
  },
  // Numbers the dialer may ring. "*" allows any. Everything else is skipped, so a fictional
  // rider list can never ring a stranger.
  dialAllowlist: listFrom("DIAL_ALLOWLIST"),
  callsPerSecond: numberFrom("DIAL_CALLS_PER_SECOND", 1),
  maxLiveCalls: numberFrom("DIAL_MAX_LIVE_CALLS", 6),
  validateTwilioSignature: optional("TWILIO_VALIDATE_SIGNATURE", "true") === "true",
  // Trial accounts play a notice and wait for a key press before our TwiML runs. Machine detection
  // would hear that notice as voicemail, so it stays off on a trial.
  twilioTrial: optional("TWILIO_TRIAL", "false") === "true",
};

export function mayDial(phone: string) {
  return env.dialAllowlist.includes("*") || env.dialAllowlist.includes(phone);
}
