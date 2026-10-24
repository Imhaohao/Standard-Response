import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CallFlow } from "../agent/callFlow";
import { minutesUntil, PlanCheck, PlanCheckEffects } from "../agent/planCheck";
import type { PlanRole } from "../agent/planInterpreter";
import { ReadyCall } from "../agent/readyCall";
import { languageOf } from "../agent/script";
import { convex, fireAndForget } from "../convex";
import type { CallMode, StreamParameters } from "./twilio";

// The two short outbound calls that aren't the evening survey: the pickup check (plan_check) and the
// Ready check census (ready). Neither creates a `calls` row; the Convex mutations log to `events`.

export const isOutboundFlowMode = (mode: CallMode) => mode === "plan_check" || mode === "ready";

const hasHouseNumber = (address: string) => /\d/.test(address);

async function planRow(planId: string) {
  const queue = await convex().query(api.pickups.callQueue, {});
  const plan = queue.find((row) => row._id === planId);
  if (!plan) throw new Error(`Pickup plan ${planId} is no longer being checked`);
  return plan;
}

function planEffects(planId: Id<"pickupPlans">, role: PlanRole, householdId: Id<"households">): PlanCheckEffects {
  return {
    helperAnswered: (coming, etaMinutes) =>
      fireAndForget("pickups.helperAnswered", convex().mutation(api.pickups.helperAnswered, { planId, coming, etaMinutes })),
    residentAnswered: (pickedUp) =>
      fireAndForget("pickups.residentAnswered", convex().mutation(api.pickups.residentAnswered, { planId, pickedUp })),
    escalate: (kind) => fireAndForget("requests.escalate", convex().mutation(api.requests.escalate, { householdId, kind })),
    unreached: () => fireAndForget("pickups.unanswered", convex().mutation(api.pickups.unanswered, { planId, role })),
  };
}

async function planCheckFor(params: StreamParameters): Promise<CallFlow> {
  const role = params.role ?? "helper";
  const plan = await planRow(params.planId ?? "");
  // Stream parameters arrive as strings.
  const notify = String(params.notify) === "true" ? { minutes: minutesUntil(plan.helperEtaAt) } : undefined;
  return new PlanCheck({
    role,
    language: languageOf(plan.language),
    helperName: plan.helperName,
    residentName: plan.residentName,
    address: plan.address,
    residentPhone: plan.residentPhone || undefined,
    helperPhone: plan.helperPhone || undefined,
    recruited: plan.recruited,
    needs: { mobility: plan.mobility, assistance: plan.assistanceRequired, oxygen: plan.oxygen },
    notify,
    effects: planEffects(plan._id, role, plan.householdId),
  });
}

async function readyCallFor(params: StreamParameters): Promise<CallFlow> {
  const householdId = params.householdId as Id<"households">;
  const household = await convex().query(api.voice.household, { householdId });
  if (!household) throw new Error(`Household ${householdId} not found`);
  return new ReadyCall({
    language: languageOf(household.language),
    addressOnFile: hasHouseNumber(household.address) ? household.address : undefined,
    residentName: household.residentName,
    effects: {
      save: (profile) => fireAndForget("ready.saveFromCall", convex().mutation(api.ready.saveFromCall, { householdId, ...profile })),
    },
  });
}

export function outboundFlowFor(params: StreamParameters): Promise<CallFlow> {
  return params.mode === "plan_check" ? planCheckFor(params) : readyCallFor(params);
}
