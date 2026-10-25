import { api } from "../../convex/_generated/api";
import type { FunctionArgs } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import type { CallFlow } from "../agent/callFlow";
import { minutesUntil, PlanCheck, PlanCheckEffects, PlanPurpose } from "../agent/planCheck";
import type { PlanRole } from "../agent/planInterpreter";
import { ReadyCall } from "../agent/readyCall";
import { languageOf } from "../agent/script";
import { convex, fireAndForget } from "../convex";
import { mayDial } from "../env";
import type { CallMode, StreamParameters } from "./callParameters";
import { simTime } from "../../lib/sim-clock";

// The two short outbound calls that aren't the evening survey: the pickup check (plan_check) and the
// Ready check census (ready). Each gets a `calls` row marked with its `flow`, so it shows on the call
// floor without counting against the home's warning call; their results go through their own mutations.

export const isOutboundFlowMode = (mode: CallMode) => mode === "plan_check" || mode === "ready";

const hasHouseNumber = (address: string) => /\d/.test(address);

async function planRow(planId: string) {
  const queue = await convex().query(api.pickups.callQueue, {});
  const plan = queue.find((row) => row._id === planId);
  if (!plan) throw new Error(`Pickup plan ${planId} is no longer being checked`);
  return plan;
}

const PURPOSES = new Set<string>(["ask", "confirm", "notice"]);
// Stream parameters arrive as strings. A call placed before purposes existed was a question.
const purposeOf = (raw: unknown): PlanPurpose => (PURPOSES.has(String(raw)) ? (String(raw) as PlanPurpose) : "ask");

function planEffects(planId: Id<"pickupPlans">, role: PlanRole, purpose: PlanPurpose, householdId: Id<"households">): PlanCheckEffects {
  return {
    helperAnswered: (coming, etaMinutes) =>
      fireAndForget("pickups.helperAnswered", convex().mutation(api.pickups.helperAnswered, { planId, coming, etaMinutes })),
    residentAnswered: (pickedUp) =>
      fireAndForget("pickups.residentAnswered", convex().mutation(api.pickups.residentAnswered, { planId, pickedUp })),
    residentConfirmed: (confirmed) =>
      fireAndForget("pickups.residentConfirmation", convex().mutation(api.pickups.residentConfirmation, { planId, confirmed })),
    noticeHeard: () => fireAndForget("pickups.noticeGiven", convex().mutation(api.pickups.noticeGiven, { planId, role })),
    escalate: (kind) => fireAndForget("requests.escalate", convex().mutation(api.requests.escalate, { householdId, kind })),
    unreached: () => fireAndForget("pickups.unanswered", convex().mutation(api.pickups.unanswered, { planId, role, purpose })),
  };
}

// The flow to run and the call-floor row to open for it.
export type OutboundFlow = { conversation: CallFlow; call: FunctionArgs<typeof api.calls.startFlow> };

export type PickupQuestion = { planId: string; role: PlanRole; purpose: PlanPurpose; continued?: boolean };

async function planCheckFor(params: StreamParameters): Promise<OutboundFlow> {
  return await pickupFlowFor({ planId: params.planId ?? "", role: params.role ?? "helper", purpose: purposeOf(params.purpose) });
}

// A pickup question, on its own call or `continued` on the person's warning call.
export async function pickupFlowFor({ planId, role, purpose, continued }: PickupQuestion): Promise<OutboundFlow> {
  const [plan, control] = await Promise.all([planRow(planId), convex().query(api.control.get, {})]);
  const notice = role === "helper" ? plan.helperNotice : plan.residentNotice;
  if (purpose === "notice" && !notice) throw new Error(`Pickup plan ${plan._id} owes the ${role} no update now`);
  const conversation = new PlanCheck({
    role,
    language: languageOf(plan.language),
    helperName: plan.helperName,
    residentName: plan.residentName,
    address: plan.address,
    residentPhone: plan.residentPhone || undefined,
    helperPhone: plan.helperPhone || undefined,
    recruited: plan.recruited,
    needs: { mobility: plan.mobility, assistance: plan.assistanceRequired, oxygen: plan.oxygen },
    purpose,
    minutes: minutesUntil(plan.helperEtaAt, simTime(control.clock, Date.now())),
    notice,
    continued,
    canConnect: role === "resident" && plan.helperPhone !== "" && mayDial(plan.helperPhone),
    effects: planEffects(plan._id, role, purpose, plan.householdId),
  });
  return { conversation, call: { householdId: plan.householdId, flow: { kind: "pickup", planId: plan._id, role, purpose } } };
}

async function readyCallFor(params: StreamParameters): Promise<OutboundFlow> {
  const householdId = params.householdId as Id<"households">;
  const [household, helperOnFile] = await Promise.all([
    convex().query(api.voice.household, { householdId }),
    convex().query(api.ready.helperOnFile, { householdId }),
  ]);
  if (!household) throw new Error(`Household ${householdId} not found`);
  const conversation = new ReadyCall({
    language: languageOf(household.language),
    addressOnFile: hasHouseNumber(household.address) ? household.address : undefined,
    residentName: household.residentName,
    helperOnFile: helperOnFile ?? undefined,
    effects: {
      save: (profile) => fireAndForget("ready.saveFromCall", convex().mutation(api.ready.saveFromCall, { householdId, ...profile })),
    },
  });
  return { conversation, call: { householdId, flow: { kind: "ready" } } };
}

export function outboundFlowFor(params: StreamParameters): Promise<OutboundFlow> {
  return params.mode === "plan_check" ? planCheckFor(params) : readyCallFor(params);
}
