import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { languageOf, LINES, statusLine } from "./agent/script";
import { convex, logSubscriptionError } from "./convex";
import { mayDial } from "./env";
import { callbackScripts, liveByHousehold, onCallEnded } from "./phone/registry";
import { placeCall } from "./phone/carrier";

// Places every queued callback: "a driver accepted" and "your driver can't reach you".
// The resident always hears the request's status as it is now, even if it changed again since the
// callback was queued. A resident already on a call hears it there, at the next sentence boundary.

const RETRY_AFTER_MS = 60_000;
const MAX_ATTEMPTS = 2;

type Pending = {
  _id: Id<"callbacks">;
  createdAt: number;
  householdId: Id<"households">;
  announces: "driver_accepted" | "reassigning";
  callbackNumber: string;
  language: string;
  residentName?: string;
};

async function currentTemplate(callback: Pending) {
  const language = languageOf(callback.language);
  const ride = await convex().query(api.voice.statusFor, { householdId: callback.householdId });
  const fallback = { status: callback.announces, driver: null };
  return { language, template: statusLine(ride ?? fallback, language) ?? "" };
}

async function deliverOnLiveCall(callback: Pending, template: string) {
  const live = liveByHousehold.get(callback.householdId);
  if (!live) return false;
  await convex().mutation(api.callbacks.markPlaced, { callbackId: callback._id });
  await live.announce(template);
  await convex().mutation(api.callbacks.markPlayed, { callbackId: callback._id });
  return true;
}

export function startCallbackRunner() {
  const handling = new Set<string>();
  const attempts = new Map<string, number>();
  const byId = new Map<string, Pending>();

  async function place(callback: Pending) {
    const { language, template } = await currentTemplate(callback);
    if (await deliverOnLiveCall(callback, template)) return;
    if (!mayDial(callback.callbackNumber)) {
      console.warn(`[callbacks] ${callback.callbackNumber} is not in DIAL_ALLOWLIST; leaving callback pending`);
      return;
    }
    const lines = LINES[language];
    callbackScripts.set(callback._id, {
      sentences: [lines.greetCallback(callback.residentName), template, lines.goodbye],
      language,
      announces: callback.announces,
    });
    attempts.set(callback._id, (attempts.get(callback._id) ?? 0) + 1);
    await convex().mutation(api.callbacks.markPlaced, { callbackId: callback._id });
    await placeCall(callback.callbackNumber, { mode: "callback", callbackId: callback._id, householdId: callback.householdId });
    console.log(`[callbacks] calling ${callback.callbackNumber}: ${callback.announces}`);
  }

  function handle(callback: Pending) {
    if (handling.has(callback._id)) return;
    handling.add(callback._id);
    byId.set(callback._id, callback);
    place(callback).catch((error) => {
      console.error(`[callbacks] ${callback._id} failed`, error);
      handling.delete(callback._id);
    });
  }

  // One call per household. It speaks the status as it is now, which covers every older callback
  // still waiting; those are marked placed, never played, because their words were not said.
  async function supersede(older: Pending[]) {
    for (const callback of older) {
      handling.add(callback._id);
      await convex().mutation(api.callbacks.markPlaced, { callbackId: callback._id });
    }
  }

  function handleAll(rows: Pending[]) {
    const newestByHousehold = new Map<string, Pending>();
    const covered: Pending[] = [];
    for (const row of [...rows].sort((a, b) => a.createdAt - b.createdAt)) {
      const previous = newestByHousehold.get(row.householdId);
      if (previous && !handling.has(previous._id)) covered.push(previous);
      newestByHousehold.set(row.householdId, row);
    }
    void supersede(covered.filter((row) => !handling.has(row._id))).catch((error) => console.error("[callbacks] supersede failed", error));
    for (const row of newestByHousehold.values()) handle(row);
  }

  // Unanswered: retry once, then send the same words as a text.
  async function unanswered(callbackId: Id<"callbacks">) {
    await convex().mutation(api.callbacks.markUnanswered, { callbackId });
    const callback = byId.get(callbackId);
    if (!callback) return;
    if ((attempts.get(callbackId) ?? 0) < MAX_ATTEMPTS) {
      setTimeout(() => place(callback).catch((error) => console.error("[callbacks] retry failed", error)), RETRY_AFTER_MS);
      return;
    }
    const { template } = await currentTemplate(callback);
    await convex().mutation(api.texts.send, { householdId: callback.householdId, body: template });
    callbackScripts.delete(callbackId);
  }

  onCallEnded((ended) => {
    if (ended.mode !== "callback" || !ended.callbackId) return;
    if (ended.answered) callbackScripts.delete(ended.callbackId);
    else void unanswered(ended.callbackId as Id<"callbacks">);
  });

  convex().onUpdate(api.voice.pendingCallbacks, {}, (rows) => handleAll(rows as Pending[]), logSubscriptionError("pendingCallbacks"));
  console.log("[callbacks] watching for callbacks to place");
}
