/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/hangUp.test.ts --environment edge-runtime
// The call floor's hang-up button: a real call is handed to the voice server to end, a simulated one ends here.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

const HOME = { phone: "+15550000001", address: "1210 Palm St", lat: 34.19, lng: -118.155, language: "en", care: [], exitPlan: "own_car" as const };

describe("hanging up from the call floor", () => {
  test("a real call is listed for the voice server to hang up until it ends", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    const householdId = await t.mutation(api.ready.submit, HOME);
    const callId = await t.mutation(api.calls.start, { householdId, direction: "outbound" });
    expect(await t.query(api.calls.hangUpRequests, {})).toEqual([]);
    await t.mutation(api.calls.requestHangUp, { callId });
    expect(await t.query(api.calls.hangUpRequests, {})).toEqual([callId]);
    await t.mutation(api.calls.end, { callId, answered: true });
    expect(await t.query(api.calls.hangUpRequests, {})).toEqual([]);
  });

  test("a simulated call ends straight away", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    const householdId = await t.mutation(api.ready.submit, HOME);
    const callId = await t.run(async (ctx) => {
      await ctx.db.patch("households", householdId, { simulated: true });
      return await ctx.db.insert("calls", { householdId, direction: "outbound", phase: "live", stage: "greet", language: "en", attempt: 1, startedAt: 0, simulated: true });
    });
    await t.mutation(api.calls.requestHangUp, { callId });
    const call = await t.run(async (ctx) => ctx.db.get("calls", callId));
    expect(call?.phase).toBe("ended");
    expect(await t.query(api.calls.hangUpRequests, {})).toEqual([]);
  });
});
