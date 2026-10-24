import { MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { seededRandom } from "./roll";
import { beginAttempt, helperReplied, MAX_HELPER_ATTEMPTS, MAX_RESIDENT_ATTEMPTS, noAnswer, residentReplied } from "./pickups";

// Stand-in for the pickup-check calls on simulated households, under the voice switch. Most helpers
// answer and come; some don't pick up, some can't, and a few never arrive. The rates are made up for
// the demo and labeled simulated, like every other stand-in.

const CALL_MS = 6_000;
const RETRY_AFTER_MS = 15_000;
const MAX_NEW_CALLS_PER_TICK = 2;
const HELPER_ANSWERS = 0.8;
const HELPER_SAYS_YES = 0.85;
const HELPER_ARRIVES = 0.9;
const RESIDENT_ANSWERS = 0.9;
const ETA_MINUTES = [2, 6] as const;

type Plan = Doc<"pickupPlans">;

const quietFor = (plan: Plan, now: number) => now - (plan.lastAttemptAt ?? 0) >= RETRY_AFTER_MS;

const helperDue = (plan: Plan, now: number) => plan.helperAttempts < MAX_HELPER_ATTEMPTS && quietFor(plan, now);

function residentDue(plan: Plan, now: number) {
  if (now < (plan.helperEtaAt ?? Infinity) || plan.residentAttempts >= MAX_RESIDENT_ATTEMPTS) return false;
  return plan.residentAttempts === 0 || quietFor(plan, now);
}

function due(plan: Plan, now: number) {
  if (plan.ringing) return false;
  return plan.status === "checking" ? helperDue(plan, now) : residentDue(plan, now);
}

async function hangUp(ctx: MutationCtx, plan: Plan) {
  const random = seededRandom(`${plan._id}:${plan.helperAttempts}:${plan.residentAttempts}`);
  const chance = (probability: number) => random() < probability;
  if (plan.ringing === "helper") {
    if (!chance(HELPER_ANSWERS)) return await noAnswer(ctx, plan, "helper");
    const [low, high] = ETA_MINUTES;
    return await helperReplied(ctx, plan, chance(HELPER_SAYS_YES), low + random() * (high - low));
  }
  if (!chance(RESIDENT_ANSWERS)) return await noAnswer(ctx, plan, "resident");
  await residentReplied(ctx, plan, chance(HELPER_ARRIVES));
}

export async function standInPickupChecks(ctx: MutationCtx, now: number) {
  const lists = await Promise.all(
    (["checking", "coming"] as const).map((status) =>
      ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(200),
    ),
  );
  let slots = MAX_NEW_CALLS_PER_TICK;
  for (const plan of lists.flat()) {
    if (!plan.simulated) continue;
    if (plan.ringing && now - (plan.lastAttemptAt ?? now) >= CALL_MS) await hangUp(ctx, plan);
    else if (slots > 0 && due(plan, now)) {
      slots -= 1;
      await beginAttempt(ctx, plan, plan.status === "checking" ? "helper" : "resident");
    }
  }
}
