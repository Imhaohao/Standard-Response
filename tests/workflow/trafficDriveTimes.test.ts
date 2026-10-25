/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { EDGES } from "../../convex/roadGraph";
import { TRAFFIC_STALE_MS } from "../../convex/traffic";

// The traffic forecast reaching the dispatcher: the runner publishes, the re-plan snapshot reads it.
// Run with: npx vitest run tests/workflow/trafficDriveTimes.test.ts --environment edge-runtime

const modules = import.meta.glob("../../convex/**/*.ts");
const WARNING_AT = Date.UTC(2026, 9, 24, 3, 0);
const range = (median: number | null) => ({ median, p5: median, p95: median, n: 4 });

function setup() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "householdsByOutcome");
  aggregateTest.register(t, "householdsByCallStatus");
  return t;
}

type T = ReturnType<typeof setup>;

// A night whose clock is paused `minutes` after the warning.
async function nightAt(t: T, minutes: number, warningIssuedAt = WARNING_AT) {
  const simAt = WARNING_AT + minutes * 60_000;
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("control").collect()) await ctx.db.delete("control", row._id);
    await ctx.db.insert("control", {
      dialerRunning: true,
      maxConcurrentCalls: 1,
      simulateVoice: true,
      simulateNeedModel: true,
      simulateDispatch: false,
      simulateDrivers: true,
      autoApprove: true,
      tickGeneration: 1,
      warningIssuedAt,
      clock: { speed: 0, realAt: Date.now(), simAt, ranMs: 0 },
    });
  });
}

function forecast(baseAt: number) {
  const window = (from: number, to: number) => ({
    from,
    to,
    streets: [{ name: EDGES[0].name, lostCarMinutes: range(3), slowdown: range(0.5), cars: range(40) }],
    segments: [],
    edges: [
      { key: EDGES[0].key, slowdown: range(0.5) },
      { key: EDGES[1].key, slowdown: range(null) },
    ],
  });
  return {
    issuedAt: Date.now(),
    warningIssuedAt: WARNING_AT,
    baseMinute: (baseAt - WARNING_AT) / 60_000,
    baseAt,
    horizonMinutes: 60,
    members: 4,
    households: 100,
    blockedSegments: 0,
    computeSeconds: 1,
    timeline: [],
    windows: [window(0, 15), window(15, 30), window(30, 60)],
  };
}

describe("traffic forecast in the dispatcher's drive times", () => {
  test("the snapshot carries each window's measured slowdowns by direction", async () => {
    const t = setup();
    await nightAt(t, 20);
    await t.mutation(api.mesh.publishTrafficForecast, forecast(WARNING_AT + 15 * 60_000));
    const snap = await t.query(internal.dispatchSnapshot.snapshot, {});
    expect(snap.traffic?.baseAt).toBe(WARNING_AT + 15 * 60_000);
    expect(snap.traffic?.windows.map((w) => [w.from, w.to])).toEqual([[0, 15], [15, 30], [30, 60]]);
    // An unmeasured median is left out, so that street drives at free flow.
    expect(snap.traffic?.windows[0].edges).toEqual([{ key: EDGES[0].key, slowdown: 0.5 }]);
  });

  test("the agency's forecast is stored without the per-direction rows", async () => {
    const t = setup();
    await nightAt(t, 20);
    await t.mutation(api.mesh.publishTrafficForecast, forecast(WARNING_AT + 15 * 60_000));
    const stored = await t.query(api.mesh.trafficForecast, {});
    expect(stored?.windows[0]).not.toHaveProperty("edges");
    expect(stored?.windows[0].streets).toHaveLength(1);
  });

  test("a stale forecast, or one from another incident, leaves streets at free flow", async () => {
    const t = setup();
    await nightAt(t, 20);
    await t.mutation(api.mesh.publishTrafficForecast, forecast(WARNING_AT + 15 * 60_000));
    await nightAt(t, 15 + TRAFFIC_STALE_MS / 60_000 + 1);
    expect((await t.query(internal.dispatchSnapshot.snapshot, {})).traffic).toBeNull();
    await nightAt(t, 20, WARNING_AT + 1);
    expect((await t.query(internal.dispatchSnapshot.snapshot, {})).traffic).toBeNull();
  });

  test("refuses a forecast with more rows by direction than the dispatcher reads", async () => {
    const t = setup();
    await nightAt(t, 20);
    const big = forecast(WARNING_AT);
    big.windows[0].edges = EDGES.slice(0, 801).map((edge) => ({ key: edge.key, slowdown: range(0.2) }));
    await expect(t.mutation(api.mesh.publishTrafficForecast, big)).rejects.toThrow("too large");
  });
});
