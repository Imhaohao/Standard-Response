import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { PlanRole } from "./agent/planInterpreter";
import { convex, logSubscriptionError } from "./convex";
import { mayDial } from "./env";
import { CallEnded, onCallEnded } from "./phone/registry";
import { placeCall } from "./phone/twilio";

// Places the pickup check's real calls. A plan in `checking` needs its helper called ("can you get
// to them now?"); a plan in `coming` needs its resident called once the helper's ETA has passed
// ("has Ana picked you up?"). An unanswered call is retried after 90 seconds; the second miss is
// the backend's to turn into a ride request or a door check.

const RETRY_AFTER_MS = 90_000;
const TICK_MS = 1000;
// The same limits as MAX_HELPER_ATTEMPTS and MAX_RESIDENT_ATTEMPTS in convex/pickups.ts, which
// can't be imported here without pulling in server-only modules.
const MAX_ATTEMPTS: Record<PlanRole, number> = { helper: 2, resident: 2 };

type Plan = FunctionReturnType<typeof api.pickups.callQueue>[number];

const attemptsOf = (plan: Plan, role: PlanRole) => (role === "helper" ? plan.helperAttempts : plan.residentAttempts);

function retryDue(plan: Plan, role: PlanRole, now: number) {
  const attempts = attemptsOf(plan, role);
  if (attempts >= MAX_ATTEMPTS[role]) return false;
  return attempts === 0 || now - (plan.lastAttemptAt ?? 0) >= RETRY_AFTER_MS;
}

// Who this plan needs called right now, if anyone. Never while a call is already ringing.
export function dueRole(plan: Plan, now: number): PlanRole | null {
  if (plan.ringing) return null;
  if (plan.status === "checking") return retryDue(plan, "helper", now) ? "helper" : null;
  const etaPassed = plan.helperEtaAt !== undefined && now >= plan.helperEtaAt;
  return plan.status === "coming" && etaPassed && retryDue(plan, "resident", now) ? "resident" : null;
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

  async function call(plan: Plan, role: PlanRole) {
    const planId = plan._id;
    const phone = phoneFor(plan, role);
    active.add(planId);
    try {
      await convex().mutation(api.pickups.startAttempt, { planId, role });
      await placeCall(phone, { mode: "plan_check", planId, role });
      console.log(`[pickups] calling the ${role} for plan ${planId} (attempt ${attemptsOf(plan, role) + 1})`);
    } catch (error) {
      console.error(`[pickups] could not call the ${role} for plan ${planId}`, error);
      active.delete(planId);
      await convex().mutation(api.pickups.unanswered, { planId, role }).catch(logUnansweredFailure);
    }
  }

  // An answered call reports its own result from the call session; only a miss is recorded here.
  function onPlanCallEnded(ended: CallEnded) {
    if (ended.mode !== "plan_check" || !ended.planId) return;
    active.delete(ended.planId);
    if (ended.answered || !ended.role) return;
    const args = { planId: ended.planId as Id<"pickupPlans">, role: ended.role };
    convex().mutation(api.pickups.unanswered, args).catch(logUnansweredFailure);
  }

  function tick() {
    if (!control?.dialerRunning) return;
    const now = Date.now();
    for (const plan of queue) {
      const role = active.has(plan._id) ? null : dueRole(plan, now);
      if (role && allowed(phoneFor(plan, role))) void call(plan, role);
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
  console.log("[pickups] watching for pickup checks to place");
}
