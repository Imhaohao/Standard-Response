import type { PlanPurpose } from "../agent/planCheck";
import type { Language } from "../agent/script";
import type { CallMode } from "./twilio";

// Shared lookups between the dialer, the callback runner, Twilio webhooks and live call sessions.

export interface LiveCall {
  readonly householdId: string | null;
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
export const liveByHousehold = new Map<string, LiveCall>();
export const callbackScripts = new Map<string, CallbackScript>();

type EndListener = (ended: CallEnded) => void;
const endListeners: EndListener[] = [];

export const onCallEnded = (listener: EndListener) => endListeners.push(listener);
export const callEnded = (ended: CallEnded) => endListeners.forEach((listener) => listener(ended));
