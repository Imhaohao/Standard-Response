import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { convex } from "./convex";
import { env, mayDial } from "./env";
import { onCallEnded } from "./phone/registry";
import { placeCall } from "./phone/twilio";

// Outbound dialer for real riders. Drains the in-zone queue highest priority first, through a token
// bucket sized to Twilio's default of 1 new call per second. The reach ladder: call, retry after
// 2 minutes; `calls:end` moves a second miss to the text step.

const RETRY_AFTER_MS = 2 * 60_000;
const QUEUE_LIMIT = 25;

type Queued = {
  _id: Id<"households">;
  callbackNumber: string;
  attempts: number;
  lastAttemptAt?: number;
  callStatus: "not_called" | "no_answer";
};

const readyToDial = (household: Queued, now: number) =>
  household.callStatus === "not_called" || now - (household.lastAttemptAt ?? 0) >= RETRY_AFTER_MS;

export function startDialer() {
  let control: Partial<Doc<"control">> | null = null;
  let queue: Queued[] = [];
  const inFlight = new Map<string, Id<"households">>();
  const dialing = new Set<string>();
  const warnedNotAllowed = new Set<string>();

  convex().onUpdate(api.control.get, {}, (row) => {
    control = row;
  });
  convex().onUpdate(api.voice.dialQueue, { limit: QUEUE_LIMIT }, (rows) => {
    queue = rows;
  });
  onCallEnded((ended) => {
    if (ended.mode === "survey" && ended.callId) inFlight.delete(ended.callId);
  });

  const busy = (id: Id<"households">) => dialing.has(id) || [...inFlight.values()].includes(id);

  function allowed(household: Queued) {
    if (mayDial(household.callbackNumber)) return true;
    if (!warnedNotAllowed.has(household._id)) {
      warnedNotAllowed.add(household._id);
      console.warn(`[dialer] ${household.callbackNumber} is not in DIAL_ALLOWLIST; skipping`);
    }
    return false;
  }

  function capacity() {
    const cap = Math.min(env.maxLiveCalls, control?.maxConcurrentCalls ?? env.maxLiveCalls);
    return cap - inFlight.size - dialing.size;
  }

  async function dial(household: Queued) {
    dialing.add(household._id);
    let callId: Id<"calls"> | null = null;
    try {
      callId = await convex().mutation(api.calls.start, { householdId: household._id, direction: "outbound" });
      inFlight.set(callId, household._id);
      await placeCall(household.callbackNumber, { mode: "survey", householdId: household._id, callId });
      console.log(`[dialer] calling ${household.callbackNumber} (attempt ${household.attempts + 1})`);
    } catch (error) {
      console.error(`[dialer] could not call ${household.callbackNumber}`, error);
      if (callId) {
        inFlight.delete(callId);
        await convex().mutation(api.calls.end, { callId, answered: false });
      }
    } finally {
      dialing.delete(household._id);
    }
  }

  function tick() {
    if (!control?.dialerRunning || !control.warningIssuedAt || capacity() <= 0) return;
    const now = Date.now();
    const next = queue.find((household) => !busy(household._id) && readyToDial(household, now) && allowed(household));
    if (next) void dial(next);
  }

  setInterval(tick, 1000 / Math.max(env.callsPerSecond, 0.1));
  console.log(`[dialer] running at ${env.callsPerSecond} call(s)/s, up to ${env.maxLiveCalls} live`);
}
