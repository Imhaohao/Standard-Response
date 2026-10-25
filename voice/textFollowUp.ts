import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { interpret } from "./agent/interpreter";
import { isEmpty, needsRide } from "./agent/record";
import { languageOf, LINES, statusLine } from "./agent/script";
import { convex, logSubscriptionError } from "./convex";

// The text step of the reach ladder for real riders. SMS registration won't clear this weekend, so
// texts live in Convex and show on the simulated phone panel. This sends the prompt in the
// rider's language and reads the reply; the reach ladder workflow (convex/reachLadder.ts) puts the
// home on the door-check list when no reply comes in time.

const CHECK_EVERY_MS = 5_000;

type FollowUp = { householdId: Id<"households">; language: string; texts: Doc<"texts">[] };

const latest = (texts: Doc<"texts">[], direction: "inbound" | "outbound") =>
  texts.filter((text) => text.direction === direction).sort((a, b) => b.at - a.at)[0];

export function startTextFollowUp() {
  let followUps: FollowUp[] = [];
  const working = new Set<string>();

  convex().onUpdate(api.voice.textFollowUps, {}, (rows) => {
    followUps = rows;
  }, logSubscriptionError("textFollowUps"));

  async function parseReply(followUp: FollowUp, reply: Doc<"texts">) {
    const language = languageOf(followUp.language);
    const heard = await interpret({
      language,
      stage: "text",
      outline: { stage: "action and needs", goal: "read what the household needs from their text reply" },
      question: LINES[language].textPrompt,
      record: {},
      recentTurns: [],
      utterance: reply.body,
    });
    const { householdId } = followUp;
    if (!isEmpty(heard.updates)) {
      await convex().mutation(api.households.update, { householdId, patch: heard.updates, confidence: heard.confidence });
    }
    if (heard.emergency !== "none") await convex().mutation(api.requests.escalate, { householdId, kind: heard.emergency });
    await convex().mutation(api.calls.resolveFollowUp, { householdId, result: "replied" });
    const ride = needsRide(heard.updates) ? statusLine({ status: "received", driver: null }, language) : LINES[language].leaveNow;
    await convex().mutation(api.texts.send, { householdId, body: `${LINES[language].textThanks} ${ride}` });
  }

  async function advance(followUp: FollowUp) {
    const sent = latest(followUp.texts, "outbound");
    if (!sent) {
      await convex().mutation(api.texts.send, { householdId: followUp.householdId, body: LINES[languageOf(followUp.language)].textPrompt });
      return;
    }
    const reply = latest(followUp.texts, "inbound");
    if (reply && reply.at > sent.at) return parseReply(followUp, reply);
  }

  setInterval(() => {
    for (const followUp of followUps) {
      if (working.has(followUp.householdId)) continue;
      working.add(followUp.householdId);
      advance(followUp)
        .catch((error) => console.error("[texts] follow-up failed", error))
        .finally(() => working.delete(followUp.householdId));
    }
  }, CHECK_EVERY_MS);
  console.log("[texts] watching the text step of the reach ladder");
}
