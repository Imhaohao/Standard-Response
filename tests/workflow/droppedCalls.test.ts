/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/droppedCalls.test.ts --environment edge-runtime
// A voice server restart drops its calls without ending them; the next boot ends the ones from before it.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}
type T = ReturnType<typeof setup>;

const HOME = { phone: "+15550000001", address: "1210 Palm St", lat: 34.19, lng: -118.155, language: "en", care: [], exitPlan: "own_car" as const };

async function liveCall(t: T, simulated = false) {
  const householdId = await t.mutation(api.ready.submit, HOME);
  return await t.run(async (ctx) =>
    ctx.db.insert("calls", { householdId, direction: "inbound", phase: "live", stage: "close", language: "en", attempt: 1, startedAt: 0, simulated }),
  );
}

const phaseOf = (t: T, callId: Id<"calls">) => t.run(async (ctx) => (await ctx.db.get("calls", callId))?.phase);

describe("calls a restart dropped", () => {
  test("a real call from before the boot ends, answered once the resident spoke", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    const spoke = await liveCall(t);
    await t.run(async (ctx) => ctx.db.insert("transcriptLines", { callId: spoke, speaker: "resident", text: "Yes.", at: 0 }));
    const silent = await liveCall(t);
    expect(await t.mutation(api.calls.endDropped, { bootedAt: Date.now() + 1000 })).toBe(2);
    expect(await phaseOf(t, spoke)).toBe("ended");
    expect(await phaseOf(t, silent)).toBe("no_answer");
  });

  test("a call started after the boot and a simulated call stay live", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    const bootedAt = Date.now() - 60_000;
    const newer = await liveCall(t);
    const simulated = await liveCall(t, true);
    expect(await t.mutation(api.calls.endDropped, { bootedAt })).toBe(0);
    expect(await phaseOf(t, newer)).toBe("live");
    expect(await phaseOf(t, simulated)).toBe("live");
  });
});
