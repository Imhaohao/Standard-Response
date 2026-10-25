import type { CallEnded } from "./registry";
import type { CallMode } from "./twilio";

const OUTBOUND_MODES = new Set<string>(["survey", "callback", "plan_check", "ready"]);

const presentOr = (value: string | null) => value || undefined;

function roleOf(query: URLSearchParams) {
  const role = query.get("role");
  return role === "helper" || role === "resident" ? role : undefined;
}

function purposeOf(query: URLSearchParams) {
  const purpose = query.get("purpose");
  return purpose === "ask" || purpose === "confirm" || purpose === "notice" ? purpose : undefined;
}

// Twilio's final status webhook for an outbound call. A call our media stream joined is reported by
// its own call session when it ends. Any other call never reached anyone, whatever CallStatus says:
// a trial-account notice that nobody pressed a key for ends as "completed" without our stream.
export function unreachedCall(query: URLSearchParams, streamed: boolean): CallEnded | null {
  const mode = query.get("mode") ?? "";
  if (streamed || !OUTBOUND_MODES.has(mode)) return null;
  return {
    mode: mode as CallMode,
    callId: presentOr(query.get("callId")),
    callbackId: presentOr(query.get("callbackId")),
    householdId: presentOr(query.get("householdId")),
    planId: presentOr(query.get("planId")),
    role: roleOf(query),
    purpose: purposeOf(query),
    answered: false,
  };
}
