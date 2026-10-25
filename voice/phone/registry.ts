import type { PlanPurpose } from "../agent/planCheck";
import type { Language } from "../agent/script";
import type { CallMode } from "./callParameters";

// Shared lookups between the dialer, the callback runner, Twilio webhooks and live call sessions.

export interface LiveCall {
  readonly householdId: string | null;
  // The call floor asked to end this call: hang up from our side and record it as answered.
  hangUpNow(): Promise<void>;
  // Plays a status template at the next sentence boundary. Resolves once the resident heard it.
  announce(template: string, language?: Language): Promise<void>;
  onMachine(): void;
}

export type CallbackScript = { sentences: string[]; language: Language; announces: "driver_accepted" | "reassigning" };

export type CallEnded = {
  mode: CallMode;
  callId?: string;
  callbackId?: string;
  householdId?: string;
  planId?: string;
  role?: "helper" | "resident";
  purpose?: PlanPurpose;
  answered: boolean;
};

export const liveByCallSid = new Map<string, LiveCall>();

// Set while a deploy stops this machine (voice/server.ts): live calls finish, nothing new is dialed.
let draining = false;
export const isDraining = () => draining;
export const startDraining = () => {
  draining = true;
};
// Twilio's call for each `calls` row we placed or answered, so the call floor can hang one up
// while it's still ringing. Entries go when the call ends.
export const callSidByCallId = new Map<string, string>();
export const liveByHousehold = new Map<string, LiveCall>();
// Calls our media stream joined. Twilio reports "completed" for a call that ended before the stream
// started (a trial-account notice nobody pressed a key for), so this set, not CallStatus, says
// whether a call reached us. The status webhook removes each entry.
export const streamedCallSids = new Set<string>();

export function registerLive(callSid: string, call: LiveCall) {
  liveByCallSid.set(callSid, call);
  streamedCallSids.add(callSid);
}
export const callbackScripts = new Map<string, CallbackScript>();

type EndListener = (ended: CallEnded) => void;
const endListeners: EndListener[] = [];

export const onCallEnded = (listener: EndListener) => endListeners.push(listener);
export const callEnded = (ended: CallEnded) => endListeners.forEach((listener) => listener(ended));
