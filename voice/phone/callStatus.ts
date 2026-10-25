import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convex } from "../convex";
import { callEnded, CallEnded } from "./registry";
import type { CallMode } from "./callParameters";

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

// The carrier's final word on an outbound call (Twilio's status webhook, Cartesia's ring timeout). A call our media stream joined is reported by
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

// A call that never reached anyone: the dialer, the runners and the Ready dialer count the miss.
export function reportUnreached(query: URLSearchParams, streamed: boolean) {
  const ended = unreachedCall(query, streamed);
  if (!ended) return;
  if (ended.mode === "survey" && ended.callId) {
    void convex().mutation(api.calls.end, { callId: ended.callId as Id<"calls">, answered: false });
  }
  callEnded(ended);
}
