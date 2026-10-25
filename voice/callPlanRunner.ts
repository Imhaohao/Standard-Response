import { api } from "../convex/_generated/api";
import { Candidate, PLANNER_MODEL, rankHomes } from "./agent/callPlanner";
import { convex, logSubscriptionError } from "./convex";
import { currentHazard } from "./hazard";

// Keeps Claude's call plan current. The first plan for a warning is made the moment the warning
// goes out; after that the list is re-planned once it has been quiet for a few seconds after a
// change (an answer, a missed call, a new estimate), so a burst of updates costs one request.

const REPLAN_AFTER_MS = 10_000;

type Snapshot = { warningIssuedAt: number | null; planned: boolean; homes: Candidate[] };

// What a re-plan depends on. Minutes left fall as the clock runs and don't count as a change.
const signatureOf = (snapshot: Snapshot) =>
  JSON.stringify([snapshot.warningIssuedAt, snapshot.homes.map((home) => ({ ...home, minutesLeft: 0 }))]);

export function startCallPlanRunner() {
  let latest: Snapshot | null = null;
  let plannedSignature = "";
  let timer: NodeJS.Timeout | null = null;
  let planning = false;
  let lastFailed = false;

  function schedule() {
    if (timer || planning || !latest?.warningIssuedAt || latest.homes.length === 0) return;
    if (signatureOf(latest) === plannedSignature) return;
    const firstTry = !latest.planned && !lastFailed;
    timer = setTimeout(() => void plan(), firstTry ? 0 : REPLAN_AFTER_MS);
  }

  async function plan() {
    timer = null;
    const snapshot = latest;
    if (!snapshot?.warningIssuedAt) return;
    planning = true;
    const signature = signatureOf(snapshot);
    const startedAt = Date.now();
    try {
      const ranked = await rankHomes(snapshot.homes, currentHazard());
      await convex().mutation(api.callPlans.save, { warningIssuedAt: snapshot.warningIssuedAt, model: PLANNER_MODEL, ranked });
      plannedSignature = signature;
      lastFailed = false;
      console.log(`[planner] ranked ${ranked.length} of ${snapshot.homes.length} homes in ${Date.now() - startedAt} ms`);
    } catch (error) {
      lastFailed = true;
      console.error("[planner] plan failed; the dialer keeps the callPriority order", error);
    } finally {
      planning = false;
      schedule();
    }
  }

  convex().onUpdate(api.callPlans.candidates, {}, (snapshot) => {
    latest = snapshot;
    schedule();
  }, logSubscriptionError("callPlans.candidates"));
}
