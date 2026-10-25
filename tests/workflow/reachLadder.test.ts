/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import type { WorkflowId } from "@convex-dev/workflow";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { realWaitMs, workflow } from "../../convex/reachLadder";
import { switchOn } from "./callList";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/reachLadder.test.ts --environment edge-runtime

const modules = import.meta.glob("../../convex/**/*.ts");
const MINUTE = 60_000;
// How long the fake dialer waits before ringing a queued retry: just past each due time.
const TO_RETRY_2 = 2 * MINUTE + 10_000;
const TO_RETRY_3 = 3 * MINUTE;

async function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  await switchOn(t);
  return t;
}

type T = Awaited<ReturnType<typeof setup>>;

// Moves the fake clock forward in small ticks, running whatever comes due on each one, so every
// sleep and step runs at its own moment (vi.runAllTimers would jump to the workpool's far-off timers).
const TICK_MS = 250;
async function settle(t: T, ms = 4 * MINUTE) {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    vi.advanceTimersByTime(TICK_MS);
    await t.finishInProgressScheduledFunctions();
  }
}

async function insertHousehold(t: T, simulated = false) {
  return await t.run(async (ctx) =>
    ctx.db.insert("households", {
      address: "100 Terrace St",
      callbackNumber: simulated ? "+16502234376" : "+14252468208",
      language: "en",
      callStatus: "not_called",
      outcome: "unknown",
      inZone: true,
      attempts: 0,
      needPrior: 0.5,
      needProbability: 0.5,
      fireArrivalAt: Date.now() + 90 * MINUTE,
      callPriority: 1,
      simulated,
    }),
  );
}

async function placeCall(t: T, householdId: Id<"households">, answered: boolean) {
  const callId = await t.mutation(api.calls.start, { householdId, direction: "outbound" });
  await t.mutation(api.calls.end, { callId, answered });
  const call = await t.run(async (ctx) => ctx.db.get("calls", callId));
  return call!.endedAt!;
}

const household = (t: T, householdId: Id<"households">) => t.run(async (ctx) => ctx.db.get("households", householdId));
const dialQueueIds = async (t: T) => (await t.query(api.voice.dialQueue, { limit: 10 })).map((row) => row._id);
const ladderView = (t: T, householdId: Id<"households">) => t.query(api.reachLadder.forHousehold, { householdId });

async function eventMessages(t: T) {
  const events = await t.run(async (ctx) => ctx.db.query("events").collect());
  return events.map((event) => ({ message: event.message, at: event.at }));
}

async function eventAt(t: T, message: string) {
  const found = (await eventMessages(t)).find((event) => event.message === message);
  expect(found, message).toBeDefined();
  return found!.at;
}

async function workflowStatus(t: T, householdId: Id<"households">) {
  const workflowId = (await household(t, householdId))!.ladder!.workflowId as WorkflowId;
  return await t.run(async (ctx) => (await workflow.status(ctx, workflowId)).type);
}

// Three missed calls: the first starts the ladder, the next two are the retries it queues.
async function missEveryCall(t: T, householdId: Id<"households">) {
  const firstMiss = await placeCall(t, householdId, false);
  await settle(t, TO_RETRY_2);
  await placeCall(t, householdId, false);
  await settle(t, TO_RETRY_3);
  const lastMiss = await placeCall(t, householdId, false);
  return { firstMiss, lastMiss };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("reach ladder workflow", () => {
  test("a rider who never answers walks every step on schedule", async () => {
    const t = await setup();
    const id = await insertHousehold(t);
    expect(await dialQueueIds(t)).toEqual([id]);

    const firstMiss = await placeCall(t, id, false);
    let rider = await household(t, id);
    expect(rider!.callStatus).toBe("no_answer");
    expect(rider!.ladder).toMatchObject({ step: "waiting_to_retry", attempt: 1, nextStepAt: firstMiss + 2 * MINUTE });
    expect(await dialQueueIds(t)).toEqual([]);
    expect(await ladderView(t, id)).toMatchObject({ step: "waiting_to_retry", nextStep: "retry", maxAttempts: 3 });

    await settle(t, TO_RETRY_2);
    const retry2At = await eventAt(t, "Retry 2 of 3 at 100 Terrace St");
    expect(retry2At - firstMiss).toBeGreaterThanOrEqual(2 * MINUTE);
    expect(retry2At - firstMiss).toBeLessThan(2 * MINUTE + 5_000);
    expect((await household(t, id))!.ladder!.step).toBe("retry_due");
    expect(await dialQueueIds(t)).toEqual([id]);

    await placeCall(t, id, false);
    expect((await household(t, id))!.ladder).toMatchObject({ step: "waiting_to_retry", nextStepAt: firstMiss + 5 * MINUTE });
    expect(await dialQueueIds(t)).toEqual([]);
    await settle(t, TO_RETRY_3);
    const retry3At = await eventAt(t, "Retry 3 of 3 at 100 Terrace St");
    expect(retry3At - firstMiss).toBeGreaterThanOrEqual(5 * MINUTE);
    expect(retry3At - firstMiss).toBeLessThan(5 * MINUTE + 5_000);

    const lastMiss = await placeCall(t, id, false);
    rider = await household(t, id);
    expect(rider!.callStatus).toBe("texted");
    expect(rider!.ladder).toMatchObject({ step: "awaiting_reply", attempt: 3, nextStepAt: lastMiss + 3 * MINUTE });
    expect(await eventAt(t, "Texted 100 Terrace St")).toBe(lastMiss);
    expect(await dialQueueIds(t)).toEqual([]);

    await settle(t);
    const doorCheckAt = await eventAt(t, "No reply: door check at 100 Terrace St");
    expect(doorCheckAt - lastMiss).toBeGreaterThanOrEqual(3 * MINUTE);
    expect(doorCheckAt - lastMiss).toBeLessThan(3 * MINUTE + 5_000);
    expect(await workflowStatus(t, id)).toBe("completed");
  });

  test("a rider nothing reaches ends on the door-check list", async () => {
    const t = await setup();
    const id = await insertHousehold(t);
    await missEveryCall(t, id);
    await settle(t);
    const rider = await household(t, id);
    expect(rider!.callStatus).toBe("door_check");
    expect(rider!.outcome).toBe("unreachable");
    expect(rider!.ladder).toMatchObject({ step: "door_check" });
    expect(rider!.ladder!.nextStepAt).toBeUndefined();
    expect(rider!.attempts).toBe(3);
    expect(await ladderView(t, id)).toMatchObject({ step: "door_check", nextStep: null, nextStepAt: null, source: "workflow" });
    const doorChecks = await t.query(api.doorChecks.queue, { limit: 10 });
    expect(doorChecks.map((row) => row._id)).toContain(id);
  });

  test("answering a retry cancels the rest of the ladder", async () => {
    const t = await setup();
    const id = await insertHousehold(t);
    await placeCall(t, id, false);
    await settle(t);
    expect((await household(t, id))!.ladder!.step).toBe("retry_due");

    await placeCall(t, id, true);
    const rider = await household(t, id);
    expect(rider!.callStatus).toBe("complete");
    expect(rider!.ladder).toMatchObject({ step: "reached" });
    expect(rider!.ladder!.nextStepAt).toBeUndefined();
    expect(await workflowStatus(t, id)).toBe("canceled");

    await settle(t, 10 * MINUTE);
    const messages = (await eventMessages(t)).map((event) => event.message);
    expect(messages).not.toContain("Retry 3 of 3 at 100 Terrace St");
    expect(messages.some((message) => message.startsWith("Texted"))).toBe(false);
    expect((await household(t, id))!.callStatus).toBe("complete");
    expect(await dialQueueIds(t)).toEqual([]);
  });

  test("an inbound call while waiting to retry cancels the ladder", async () => {
    const t = await setup();
    const id = await insertHousehold(t);
    await placeCall(t, id, false);
    const callId = await t.mutation(api.calls.start, { householdId: id, direction: "inbound" });
    await t.mutation(api.calls.end, { callId, answered: true });
    expect((await household(t, id))!.ladder!.step).toBe("reached");
    await settle(t);
    const messages = (await eventMessages(t)).map((event) => event.message);
    expect(messages).not.toContain("Retry 2 of 3 at 100 Terrace St");
    expect(await workflowStatus(t, id)).toBe("canceled");
  });

  test("a text reply stops the ladder before the door check", async () => {
    const t = await setup();
    const id = await insertHousehold(t);
    await missEveryCall(t, id);
    expect((await household(t, id))!.callStatus).toBe("texted");

    vi.advanceTimersByTime(MINUTE);
    await t.mutation(api.texts.reply, { householdId: id, body: "2" });
    let rider = await household(t, id);
    expect(rider!.ladder).toMatchObject({ step: "replied" });
    expect(rider!.ladder!.nextStepAt).toBeUndefined();
    expect(rider!.callStatus).toBe("texted");
    expect(await workflowStatus(t, id)).toBe("canceled");

    await settle(t);
    const messages = (await eventMessages(t)).map((event) => event.message);
    expect(messages.some((message) => message.startsWith("No reply"))).toBe(false);
    expect((await household(t, id))!.callStatus).toBe("texted");

    // The voice server parses the reply and closes the follow-up.
    await t.mutation(api.calls.resolveFollowUp, { householdId: id, result: "replied" });
    rider = await household(t, id);
    expect(rider!.callStatus).toBe("complete");
    expect(rider!.ladder!.step).toBe("replied");
  });

  test("simulated households keep the stand-in ladder", async () => {
    const t = await setup();
    const id = await insertHousehold(t, true);
    await placeCall(t, id, false);
    expect((await household(t, id))!).toMatchObject({ callStatus: "no_answer" });
    expect((await household(t, id))!.ladder).toBeUndefined();
    expect(await ladderView(t, id)).toMatchObject({ step: "waiting_to_retry", nextStep: "retry", maxAttempts: 2, source: "call_status" });
    await placeCall(t, id, false);
    expect((await household(t, id))!).toMatchObject({ callStatus: "texted" });
    expect((await household(t, id))!.ladder).toBeUndefined();
    await settle(t);
    expect((await household(t, id))!.callStatus).toBe("texted");
  });
});

describe("night clock", () => {
  test("waits are slept in short pieces scaled by the playback speed", () => {
    const now = 1_000_000;
    expect(realWaitMs(now + 2 * MINUTE, now, 1)).toBe(20_000);
    expect(realWaitMs(now + MINUTE, now, 10)).toBe(6_000);
    expect(realWaitMs(now, now + 1, 1)).toBe(0);
    expect(realWaitMs(now + MINUTE, now, 0)).toBe(20_000);
  });
});
