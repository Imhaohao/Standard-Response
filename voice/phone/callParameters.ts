import type { PlanPurpose } from "../agent/planCheck";

// What one call is for, whichever carrier places it. Twilio carries these as stream parameters and
// callback query strings; Cartesia keeps them on our side, keyed by its call id.

export type CallMode = "survey" | "callback" | "inbound" | "plan_check" | "ready";

export type StreamParameters = {
  mode: CallMode;
  householdId?: string;
  callId?: string;
  callbackId?: string;
  from?: string;
  planId?: string;
  role?: "helper" | "resident";
  // What a pickup call is for: its question, the resident's confirmation, or a status update.
  purpose?: PlanPurpose;
};

// The parameters as the query string the status and machine-detection callbacks read back.
export function callQuery(parameters: StreamParameters) {
  return {
    mode: parameters.mode,
    callId: parameters.callId ?? "",
    callbackId: parameters.callbackId ?? "",
    householdId: parameters.householdId ?? "",
    planId: parameters.planId ?? "",
    role: parameters.role ?? "",
    purpose: parameters.purpose ?? "",
  };
}
