import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { PlanPurpose } from "./agent/planCheck";
import type { PlanRole } from "./agent/planInterpreter";
import { convex, logSubscriptionError } from "./convex";
import { mayDial } from "./env";
import { CallEnded, liveByHousehold, onCallEnded } from "./phone/registry";
import { placeCall } from "./phone/twilio";
import { simTime } from "../lib/sim-clock";

// Places the pickup check's real calls, so both sides confirm a pickup and hear when it changes:
//   1. a plan in `checking`: the helper is asked whether they can go, and roughly when;
//   2. once they say yes (`coming`): the resident is asked whether they'll go with them;
//   3. a status update owed to either side: the helper hears the resident is ready, or that the
//      pickup is off; the resident hears their helper can't come;
//   4. once the helper's ETA has passed: the resident is asked whether they were picked up.
// Updates go first, since they change what someone is doing right now. Nobody is rung while they're
// on another call with us. An unanswered call is retried after 90 seconds; what a second miss means
// is the backend's call.

const RETRY_AFTER_MS = 90_000;
const TICK_MS = 1000;
// The same limits as MAX_HELPER_ATTEMPTS, MAX_RESIDENT_ATTEMPTS, MAX_CONFIRM_ATTEMPTS and
// MAX_NOTICE_ATTEMPTS in convex/pickups.ts, which can't be imported here without pulling in
// server-only modules.
const MAX_ATTEMPTS = 2;

type Plan = FunctionReturnType<typeof api.pickups.callQueue>[number];
export type PlanCall = { role: PlanRole; purpose: PlanPurpose };

export function attemptsOf(plan: Plan, { role, purpose }: PlanCall) {
  if (purpose === "confirm") return plan.confirmAttempts;
  if (purpose === "notice") return role === "helper" ? plan.helperNoticeAttempts : plan.residentNoticeAttempts;
  return role === "helper" ? plan.helperAttempts : plan.residentAttempts;
}

function retryDue(plan: Plan, call: PlanCall, now: number) {
  const attempts = attemptsOf(plan, call);
  if (attempts >= MAX_ATTEMPTS) return false;
  return attempts === 0 || now - (plan.lastAttemptAt ?? 0) >= RETRY_AFTER_MS;
}

const confirming = (plan: Plan) => plan.status === "coming" && plan.residentConfirmedAt === undefined && plan.confirmAttempts < MAX_ATTEMPTS;

// The calls this plan could need, most pressing first.
function candidates(plan: Plan, now: number): PlanCall[] {
  const calls: PlanCall[] = [];
  if (plan.helperNotice) calls.push({ role: "helper", purpose: "notice" });
  if (plan.residentNotice) calls.push({ role: "resident", purpose: "notice" });
  if (plan.status === "checking") calls.push({ role: "helper", purpose: "ask" });
  else if (plan.status === "coming" && confirming(plan)) calls.push({ role: "resident", purpose: "confirm" });
  else if (plan.status === "coming" && plan.helperEtaAt !== undefined && now >= plan.helperEtaAt) calls.push({ role: "resident", purpose: "ask" });
  return calls;
}

// Who this plan needs called right now, and why, if anyone. Never while one of its calls is
// ringing, and never while that person is still on another call with us: theirs would come up busy.
export function dueCall(plan: Plan, now: number, onAnotherCall: (householdId: string) => boolean = () => false): PlanCall | null {
  if (plan.ringing) return null;
  const busy = ({ role }: PlanCall) => {
    const householdId = role === "helper" ? plan.helperHouseholdId : plan.householdId;
    return householdId !== undefined && onAnotherCall(householdId);
  };
  return candidates(plan, now).find((call) => !busy(call) && retryDue(plan, call, now)) ?? null;
}

const logUnansweredFailure = (error: unknown) => console.error("[pickups] could not record the missed call", error);

const phoneFor = (plan: Plan, role: PlanRole) => (role === "helper" ? plan.helperPhone : plan.residentPhone);

export function startPickupRunner() {
  let control: Partial<Doc<"control">> | null = null;
  let queue: Plan[] = [];
  const active = new Set<string>();
  const warnedNotAllowed = new Set<string>();

  function allowed(phone: string) {
    if (mayDial(phone)) return true;
    if (!warnedNotAllowed.has(phone)) {
      warnedNotAllowed.add(phone);
      console.warn(`[pickups] ${phone} is not in DIAL_ALLOWLIST; skipping`);
    }
    return false;
  }

  async function call(plan: Plan, { role, purpose }: PlanCall) {
    const planId = plan._id;
    active.add(planId);
    try {
      await convex().mutation(api.pickups.startAttempt, { planId, role, purpose });
      await placeCall(phoneFor(plan, role), { mode: "plan_check", planId, role, purpose });
      console.log(`[pickups] calling the ${role} for plan ${planId} (${purpose}, attempt ${attemptsOf(plan, { role, purpose }) + 1})`);
    } catch (error) {
      console.error(`[pickups] could not call the ${role} for plan ${planId}`, error);
      active.delete(planId);
      await convex().mutation(api.pickups.unanswered, { planId, role, purpose }).catch(logUnansweredFailure);
    }
  }

  // An answered call reports its own result from the call session; only a miss is recorded here.
  function onPlanCallEnded(ended: CallEnded) {
    if (ended.mode !== "plan_check" || !ended.planId) return;
    active.delete(ended.planId);
    if (ended.answered || !ended.role) return;
    const args = { planId: ended.planId as Id<"pickupPlans">, role: ended.role, purpose: ended.purpose };
    convex().mutation(api.pickups.unanswered, args).catch(logUnansweredFailure);
  }

  function tick() {
    if (!control?.dialerRunning) return;
    // Attempts and ETAs are stored on the night's clock, which can run ahead of the wall clock.
    const now = simTime(control.clock, Date.now());
    for (const plan of queue) {
      if (active.has(plan._id)) continue;
      const due = dueCall(plan, now, (householdId) => liveByHousehold.has(householdId));
      if (due && allowed(phoneFor(plan, due.role))) void call(plan, due);
    }
  }

  convex().onUpdate(api.control.get, {}, (row) => {
    control = row;
  }, logSubscriptionError("control"));
  convex().onUpdate(api.pickups.callQueue, {}, (rows) => {
    queue = rows;
  }, logSubscriptionError("pickups.callQueue"));
  onCallEnded(onPlanCallEnded);
  setInterval(tick, TICK_MS);
  console.log("[pickups] watching for pickup calls to place");
}
