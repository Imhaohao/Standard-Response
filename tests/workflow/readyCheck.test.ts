/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Run with: npx vitest run tests/workflow/readyCheck.test.ts --environment edge-runtime
// The Ready check stand-in calls simulated homes as calls on the floor: each rings, talks through its
// script, saves the profile and leaves an activity row that opens it.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "householdsByOutcome");
  aggregateTest.register(t, "householdsByCallStatus");
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

const readyCalls = (t: T) => t.run(async (ctx) => (await ctx.db.query("calls").collect()).filter((call) => call.flow?.kind === "ready"));

async function tick(t: T, times: number) {
  for (let i = 0; i < times; i++) {
    const control = await t.run(async (ctx) => ctx.db.query("control").first());
    await t.mutation(internal.ready.tick, { generation: control?.readyCheckGeneration ?? 0 });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ready check stand-in", () => {
  test("simulated homes are called on the floor, and a finished call opens from the activity list", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.mutation(api.ready.start, {});

    await tick(t, 1);
    const ringing = await readyCalls(t);
    expect(ringing.length).toBeGreaterThan(0);
    expect(ringing.every((call) => call.simulated && call.phase === "ringing")).toBe(true);
    expect((await t.query(api.calls.active, {})).length).toBe(ringing.length);

    await tick(t, 12);
    const finished = (await readyCalls(t)).find((call) => call.phase === "ended");
    expect(finished).toBeDefined();
    const detail = await t.query(api.calls.detail, { callId: finished!._id });
    expect(detail?.lines.length).toBeGreaterThan(10);
    expect(detail?.lines[0].speaker).toBe("agent");
    expect(detail?.household?.ready?.verified).toBe(true);
    expect(detail?.household?.peopleCount).toBeDefined();

    const events = await t.query(api.events.recent, { limit: 100 });
    expect(events.find((event) => event.callId === finished!._id)?.kind).toBe("call");
  });

  test("pausing the Ready check hangs up its stand-in calls", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.mutation(api.ready.start, {});
    await tick(t, 3);
    expect((await t.query(api.calls.active, {})).length).toBeGreaterThan(0);

    await t.mutation(api.ready.stop, {});
    expect(await t.query(api.calls.active, {})).toEqual([]);
  });
});
