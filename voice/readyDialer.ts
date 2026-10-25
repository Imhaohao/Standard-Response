import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { convex, logSubscriptionError } from "./convex";
import { mayDial } from "./env";
import { CallEnded, onCallEnded } from "./phone/registry";
import { placeCall } from "./phone/carrier";

// Places the Ready check's census calls while the campaign runs. `ready:queue` lists the real
// households still to reach; a home that missed is tried again after 2 minutes, and the backend
// stops listing it after its second miss. A calm afternoon needs no rush, so two calls at a time.

const RETRY_AFTER_MS = 2 * 60_000;
const MAX_LIVE = 2;
const TICK_MS = 1000;

type Household = FunctionReturnType<typeof api.ready.queue>[number];

export function startReadyDialer() {
  let queue: Household[] = [];
  const live = new Set<string>();
  // When this server last saw each home miss. A restart forgets it, which only means one early retry.
  const missedAt = new Map<string, number>();
  // Homes someone answered for this run, including a "not now": they aren't called again.
  const reached = new Set<string>();
  const warnedNotAllowed = new Set<string>();

  function allowed(household: Household) {
    if (mayDial(household.callbackNumber)) return true;
    if (!warnedNotAllowed.has(household._id)) {
      warnedNotAllowed.add(household._id);
      console.warn(`[ready] ${household.callbackNumber} is not in DIAL_ALLOWLIST; skipping`);
    }
    return false;
  }

  function due(household: Household, now: number) {
    if (live.has(household._id) || reached.has(household._id)) return false;
    return now - (missedAt.get(household._id) ?? 0) >= RETRY_AFTER_MS;
  }

  async function recordMiss(householdId: string) {
    missedAt.set(householdId, Date.now());
    await convex().mutation(api.ready.missed, { householdId: householdId as Id<"households"> });
  }

  async function dial(household: Household) {
    live.add(household._id);
    try {
      await placeCall(household.callbackNumber, { mode: "ready", householdId: household._id });
      console.log(`[ready] calling ${household.callbackNumber} (miss count ${household.readyMisses})`);
    } catch (error) {
      console.error(`[ready] could not call ${household.callbackNumber}`, error);
      live.delete(household._id);
      await recordMiss(household._id);
    }
  }

  function onReadyCallEnded(ended: CallEnded) {
    if (ended.mode !== "ready" || !ended.householdId) return;
    live.delete(ended.householdId);
    if (ended.answered) reached.add(ended.householdId);
    else recordMiss(ended.householdId).catch((error) => console.error("[ready] could not record the miss", error));
  }

  function tick() {
    const now = Date.now();
    const next = queue.filter((household) => due(household, now) && allowed(household));
    for (const household of next.slice(0, MAX_LIVE - live.size)) void dial(household);
  }

  convex().onUpdate(api.ready.queue, {}, (rows) => {
    queue = rows;
  }, logSubscriptionError("ready.queue"));
  onCallEnded(onReadyCallEnded);
  setInterval(tick, TICK_MS);
  console.log(`[ready] Ready check dialer up, ${MAX_LIVE} calls at a time`);
}
