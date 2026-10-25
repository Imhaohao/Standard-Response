import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { convex, logSubscriptionError } from "./convex";
import { env, mayDial } from "./env";
import { isDraining, onCallEnded } from "./phone/registry";
import { placeCall } from "./phone/carrier";

// Outbound dialer for real riders. Drains the in-zone queue highest priority first, through a token
// bucket sized to Twilio's default of 1 new call per second. Retry timing lives in Convex: the reach
// ladder workflow (convex/reachLadder.ts) keeps a missed rider out of `voice:dialQueue` until the
// retry at 2 or 5 minutes is due, so every household in the queue may be rung now.

const QUEUE_LIMIT = 25;

type Queued = {
  _id: Id<"households">;
  callbackNumber: string;
  attempts: number;
  lastAttemptAt?: number;
  callStatus: "not_called" | "no_answer";
};

export function startDialer() {
  let control: Partial<Doc<"control">> | null = null;
  let queue: Queued[] = [];
  const inFlight = new Map<string, Id<"households">>();
  const dialing = new Set<string>();
  const warnedNotAllowed = new Set<string>();

  convex().onUpdate(api.control.get, {}, (row) => {
    control = row;
  }, logSubscriptionError("control"));
  convex().onUpdate(api.voice.dialQueue, { limit: QUEUE_LIMIT }, (rows) => {
    queue = rows;
  }, logSubscriptionError("dialQueue"));
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
    if (isDraining() || !control?.dialerRunning || !control.warningIssuedAt || capacity() <= 0) return;
    const next = queue.find((household) => !busy(household._id) && allowed(household));
    if (next) void dial(next);
  }

  setInterval(tick, 1000 / Math.max(env.callsPerSecond, 0.1));
  console.log(`[dialer] running at ${env.callsPerSecond} call(s)/s, up to ${env.maxLiveCalls} live`);
}
