import { v } from "convex/values";
import { cancel, sendEvent, WorkflowManager, type WorkflowCtx, type WorkflowId } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";
import { internalQuery, query, MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { callStatus } from "./schema";
import { outcomeFor } from "./model";
import { simNow } from "./clock";

// The reach ladder for real riders (PLAN rule 4, "Never treat silence as safe"): call, retry at 2
// minutes, retry at 5, text, then the door-check queue. One durable workflow per rider owns the
// timing. It starts on the first unanswered call and is cancelled the moment the rider answers or
// texts back. The voice server still places every call: the workflow only decides when a household
// is back in `voice:dialQueue` (ladder step `retry_due`).
//
// Simulated households keep the stand-in's fast ladder in sim.ts, which reads the constants below.

export const MAX_VOICE_ATTEMPTS = 3;
// Retry 2 and retry 3 are due this long after the first miss.
const RETRY_AFTER_FIRST_MISS_MS = [2 * 60_000, 5 * 60_000];
// A retry that ran late still leaves the line quiet this long before the next one.
const MIN_RETRY_GAP_MS = 2 * 60_000;
export const REPLY_WAIT_MS = 3 * 60_000;
// The night clock can be paused or sped up, so a long wait is slept in short pieces and re-checked.
const MAX_SLEEP_MS = 20_000;

export const STAND_IN_MAX_VOICE_ATTEMPTS = 2;
export const STAND_IN_RETRY_AFTER_MS = 20_000;
export const STAND_IN_TEXT_REPLY_WAIT_MS = 25_000;

type Household = Doc<"households">;
type Ladder = NonNullable<Household["ladder"]>;
type LadderStep = Ladder["step"];
type EndedStep = Extract<LadderStep, "reached" | "replied" | "door_check">;

const ENDED_STEPS = new Set<LadderStep>(["reached", "replied", "door_check"]);
const CALL_MISSED = "callMissed";

export const workflow = new WorkflowManager(components.workflow);

export const activeLadder = (household: Household): Ladder | null =>
  household.ladder && !ENDED_STEPS.has(household.ladder.step) ? household.ladder : null;

// What the voice server may ring now. A real rider in the middle of a ladder waits for the workflow
// to put it back in the queue; a home with no ladder yet (never called, or missed before the
// workflow existed) is dialable as before.
export function dialableNow(household: Household) {
  if (household.callStatus === "not_called") return true;
  const ladder = activeLadder(household);
  return ladder === null || ladder.step === "retry_due";
}

async function logStep(ctx: MutationCtx, household: Household, message: string, at: number) {
  await ctx.db.insert("events", { kind: "retry", message, householdId: household._id, at });
}

async function patchLadder(ctx: MutationCtx, household: Household, ladder: Ladder, patch: Partial<Household> = {}) {
  await ctx.db.patch("households", household._id, { ...patch, ladder });
}

function nextRetryAt(ladder: Ladder, now: number) {
  const scheduled = ladder.firstMissAt + RETRY_AFTER_FIRST_MISS_MS[ladder.attempt - 1];
  return ladder.attempt === 1 ? scheduled : Math.max(scheduled, now + MIN_RETRY_GAP_MS);
}

async function startLadder(ctx: MutationCtx, household: Household, now: number) {
  const workflowId = await workflow.start(ctx, internal.reachLadder.run, { householdId: household._id });
  const ladder: Ladder = { workflowId, step: "waiting_to_retry", attempt: 1, firstMissAt: now, updatedAt: now };
  await patchLadder(ctx, household, { ...ladder, nextStepAt: nextRetryAt(ladder, now) }, { callStatus: "no_answer" });
  await logStep(ctx, household, `No answer at ${household.address}. Retry 2 of ${MAX_VOICE_ATTEMPTS} in 2 minutes`, now);
}

async function textAfterLastMiss(ctx: MutationCtx, household: Household, ladder: Ladder, now: number) {
  const next: Ladder = { ...ladder, step: "awaiting_reply", nextStepAt: now + REPLY_WAIT_MS, updatedAt: now };
  await patchLadder(ctx, household, next, { callStatus: "texted" });
  await logStep(ctx, household, `Texted ${household.address}`, now);
}

async function waitForNextRetry(ctx: MutationCtx, household: Household, ladder: Ladder, now: number) {
  const next: Ladder = { ...ladder, step: "waiting_to_retry", nextStepAt: nextRetryAt(ladder, now), updatedAt: now };
  await patchLadder(ctx, household, next, { callStatus: "no_answer" });
}

const statusDuring = (ladder: Ladder) => (ladder.step === "awaiting_reply" ? "texted" : "no_answer");

// calls:end for a real rider who didn't pick up. The first miss starts the workflow; a miss on a
// retry the workflow queued moves the ladder on and wakes the workflow. Any other miss (an inbound
// call that dropped mid-wait) leaves the ladder where it was.
export async function recordMiss(ctx: MutationCtx, household: Household, now: number) {
  const ladder = activeLadder(household);
  if (!ladder) return await startLadder(ctx, household, now);
  if (ladder.step !== "retrying") {
    await ctx.db.patch("households", household._id, { callStatus: statusDuring(ladder) });
    return;
  }
  if (ladder.attempt >= MAX_VOICE_ATTEMPTS) await textAfterLastMiss(ctx, household, ladder, now);
  else await waitForNextRetry(ctx, household, ladder, now);
  await sendEvent(ctx, components.workflow, { name: CALL_MISSED, workflowId: ladder.workflowId as WorkflowId });
}

// calls:start: the call the workflow queued is ringing.
export function ladderOnDial(household: Household, now: number): Partial<Household> {
  const ladder = activeLadder(household);
  if (ladder?.step !== "retry_due") return {};
  return { ladder: { ...ladder, step: "retrying", updatedAt: now } };
}

// The rider answered, texted back, or was sent to the door-check list another way: cancel the
// workflow at once so no retry or door check follows.
export async function stopLadder(ctx: MutationCtx, householdId: Id<"households">, step: EndedStep) {
  const household = await ctx.db.get("households", householdId);
  const ladder = household && activeLadder(household);
  if (!household || !ladder) return;
  const now = await simNow(ctx);
  await patchLadder(ctx, household, { ...ladder, step, nextStepAt: undefined, updatedAt: now });
  try {
    await cancel(ctx, components.workflow, ladder.workflowId as WorkflowId);
  } catch (error) {
    console.warn(`[ladder] could not cancel ${ladder.workflowId}`, error);
  }
}

// --- Workflow steps. Each one checks the ladder still belongs to this workflow and is still live.

const stepArgs = { householdId: v.id("households"), workflowId: v.string() };

async function ownLadder(ctx: QueryCtx, householdId: Id<"households">, workflowId: string) {
  const household = await ctx.db.get("households", householdId);
  const ladder = household && activeLadder(household);
  if (!household || !ladder || ladder.workflowId !== workflowId) return null;
  return { household, ladder };
}

export function realWaitMs(nextStepAt: number, now: number, speed: number) {
  if (speed <= 0) return MAX_SLEEP_MS;
  return Math.min(MAX_SLEEP_MS, Math.max(0, (nextStepAt - now) / speed));
}

export const checkDue = internalQuery({
  args: stepArgs,
  returns: v.object({ state: v.union(v.literal("due"), v.literal("wait"), v.literal("stop")), waitMs: v.number() }),
  handler: async (ctx, { householdId, workflowId }) => {
    const owned = await ownLadder(ctx, householdId, workflowId);
    if (!owned) return { state: "stop" as const, waitMs: 0 };
    const control = await ctx.db.query("control").first();
    const waitMs = realWaitMs(owned.ladder.nextStepAt ?? 0, await simNow(ctx), control?.clock?.speed ?? 1);
    return { state: waitMs > 0 ? ("wait" as const) : ("due" as const), waitMs };
  },
});

export const queueRetry = internalMutation({
  args: { ...stepArgs, attempt: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { householdId, workflowId, attempt }) => {
    const owned = await ownLadder(ctx, householdId, workflowId);
    if (owned?.ladder.step !== "waiting_to_retry") return false;
    const now = await simNow(ctx);
    const ladder: Ladder = { ...owned.ladder, step: "retry_due", attempt, nextStepAt: undefined, updatedAt: now };
    await patchLadder(ctx, owned.household, ladder);
    await logStep(ctx, owned.household, `Retry ${attempt} of ${MAX_VOICE_ATTEMPTS} at ${owned.household.address}`, now);
    return true;
  },
});

export const sendToDoorCheck = internalMutation({
  args: stepArgs,
  returns: v.null(),
  handler: async (ctx, { householdId, workflowId }) => {
    const owned = await ownLadder(ctx, householdId, workflowId);
    if (owned?.ladder.step !== "awaiting_reply") return null;
    const { household } = owned;
    const now = await simNow(ctx);
    await patchLadder(ctx, household, { ...owned.ladder, step: "door_check", nextStepAt: undefined, updatedAt: now }, {
      callStatus: "door_check",
      outcome: outcomeFor({ ...household, callStatus: "door_check" }),
    });
    await logStep(ctx, household, `No reply: door check at ${household.address}`, now);
    return null;
  },
});

type StepIds = { householdId: Id<"households">; workflowId: string };

// Sleeps until the ladder's next step is due on the night clock. False means the ladder ended.
async function untilDue(step: WorkflowCtx, ids: StepIds) {
  for (;;) {
    const check = await step.runQuery(internal.reachLadder.checkDue, ids);
    if (check.state !== "wait") return check.state === "due";
    await step.sleep(check.waitMs, { name: "untilDue" });
  }
}

export const run = workflow.define({ args: { householdId: v.id("households") } }).handler(
  async (step, { householdId }): Promise<void> => {
    const ids = { householdId, workflowId: step.workflowId };
    for (let attempt = 2; attempt <= MAX_VOICE_ATTEMPTS; attempt++) {
      if (!(await untilDue(step, ids))) return;
      if (!(await step.runMutation(internal.reachLadder.queueRetry, { ...ids, attempt }))) return;
      // calls:end sends this when the queued retry goes unanswered; the last miss also sends the text.
      await step.awaitEvent({ name: CALL_MISSED });
    }
    if (!(await untilDue(step, ids))) return;
    await step.runMutation(internal.reachLadder.sendToDoorCheck, ids);
  },
);

// --- What the call floor and rescue map read.

const viewStep = v.union(
  v.literal("first_call"),
  v.literal("waiting_to_retry"),
  v.literal("retry_due"),
  v.literal("retrying"),
  v.literal("awaiting_reply"),
  v.literal("reached"),
  v.literal("replied"),
  v.literal("door_check"),
);

const ladderView = v.object({
  householdId: v.id("households"),
  address: v.string(),
  simulated: v.boolean(),
  callStatus,
  step: viewStep,
  attempt: v.number(),
  maxAttempts: v.number(),
  nextStep: v.union(v.literal("retry"), v.literal("door_check"), v.null()),
  nextStepAt: v.union(v.number(), v.null()),
  // "workflow": a real rider on the ladder workflow. "call_status": read from callStatus (simulated
  // homes on the stand-in timing, and real riders not yet missed).
  source: v.union(v.literal("workflow"), v.literal("call_status")),
});

type LadderView = typeof ladderView.type;
type Derived = Pick<LadderView, "step" | "nextStep" | "nextStepAt">;

const NEXT_STEP: Partial<Record<LadderStep, LadderView["nextStep"]>> = {
  waiting_to_retry: "retry",
  awaiting_reply: "door_check",
};

const STAND_IN_WAIT: Partial<Record<Household["callStatus"], number>> = {
  no_answer: STAND_IN_RETRY_AFTER_MS,
  texted: STAND_IN_TEXT_REPLY_WAIT_MS,
};

const STEP_FOR_STATUS: Record<Household["callStatus"], LadderView["step"]> = {
  not_called: "first_call",
  in_call: "retrying",
  no_answer: "waiting_to_retry",
  texted: "awaiting_reply",
  door_check: "door_check",
  complete: "reached",
};

const fromWorkflow = (ladder: Ladder): Derived => ({
  step: ladder.step,
  nextStep: NEXT_STEP[ladder.step] ?? null,
  nextStepAt: ladder.nextStepAt ?? null,
});

// Homes with no workflow: simulated ones on the stand-in's timing, and real ones not yet missed.
function fromStatus(household: Household): Derived {
  const firstCall = household.callStatus === "in_call" && household.attempts <= 1;
  const step = firstCall ? "first_call" : STEP_FOR_STATUS[household.callStatus];
  const wait = household.simulated ? STAND_IN_WAIT[household.callStatus] : undefined;
  const nextStepAt = wait !== undefined && household.lastAttemptAt !== undefined ? household.lastAttemptAt + wait : null;
  return { step, nextStep: NEXT_STEP[step as LadderStep] ?? null, nextStepAt };
}

function viewOf(household: Household): LadderView {
  const derived = household.ladder ? fromWorkflow(household.ladder) : fromStatus(household);
  return {
    householdId: household._id,
    address: household.address,
    simulated: household.simulated,
    callStatus: household.callStatus,
    ...derived,
    attempt: household.ladder?.attempt ?? household.attempts,
    maxAttempts: household.simulated ? STAND_IN_MAX_VOICE_ATTEMPTS : MAX_VOICE_ATTEMPTS,
    source: household.ladder ? "workflow" : "call_status",
  };
}

// Every in-zone household's place on the ladder. `nextStepAt` is on the night clock (clock.ts).
export const steps = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(ladderView),
  handler: async (ctx, { limit }) => {
    const households = await ctx.db.query("households").take(limit ?? 1000);
    return households.filter((h) => h.inZone).map(viewOf);
  },
});

// The call floor's "No answer" list: only homes past their first miss, read by call status through
// the index instead of scanning every household on every write. A live call counts when it is a
// retry. Steps still waiting come first, soonest next step first; door checks last.
const UNANSWERED_STATUSES = ["no_answer", "texted", "door_check", "in_call"] as const;
const UNANSWERED_PER_STATUS = 300;

const isRetry = (row: LadderView) => row.step !== "first_call";
const dueOrder = (row: LadderView) => row.nextStepAt ?? (row.step === "door_check" ? Infinity : -Infinity);

export const unanswered = query({
  args: {},
  returns: v.array(ladderView),
  handler: async (ctx) => {
    const rows: LadderView[] = [];
    for (const status of UNANSWERED_STATUSES) {
      const homes = await ctx.db
        .query("households")
        .withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", status))
        .order("desc")
        .take(UNANSWERED_PER_STATUS);
      rows.push(...homes.filter((home) => home.inZone).map(viewOf).filter(isRetry));
    }
    return rows.sort((a, b) => (dueOrder(a) === dueOrder(b) ? 0 : dueOrder(a) < dueOrder(b) ? -1 : 1));
  },
});

export const forHousehold = query({
  args: { householdId: v.id("households") },
  returns: v.union(ladderView, v.null()),
  handler: async (ctx, { householdId }) => {
    const household = await ctx.db.get("households", householdId);
    return household ? viewOf(household) : null;
  },
});
