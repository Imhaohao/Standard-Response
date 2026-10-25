/// <reference types="vite/client" />
// Run from the repo root: npx vitest run apify/tests --environment edge-runtime
import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { closedEdgesFor } from "../../convex/roadGraph";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts");

const SECRET = "test-secret";
const ENDPOINT = "/apify/road-closures";

// One block of Lincoln Avenue in west Altadena, from the road graph, GeoJSON order [longitude, latitude].
const LINCOLN_BLOCK = [
  [-118.15957, 34.16982],
  [-118.15956, 34.16841],
];
// A line across that block of Lincoln Avenue: it cuts the street but runs along none.
const ACROSS_LINCOLN = [
  [-118.1606, 34.1691],
  [-118.1586, 34.1691],
];
const SACRAMENTO = [
  [-121.5, 38.5],
  [-121.4, 38.55],
];

const closure = (overrides: Record<string, unknown> = {}) => ({
  source: "caltrans-lcs",
  sourceUrl: "https://example.test/lcs",
  kind: "road_closure",
  id: "LCS-1",
  name: "Lincoln Ave",
  county: "Los Angeles",
  status: "closed",
  updatedAt: "2026-10-24T12:00:00.000Z",
  geometry: { type: "LineString", coordinates: LINCOLN_BLOCK },
  ...overrides,
});

function makeBackend() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "householdsByOutcome");
  aggregateTest.register(t, "householdsByCallStatus");
  return t;
}

type Backend = ReturnType<typeof makeBackend>;

const post = (t: Backend, body: unknown, authorization: string | null = `Bearer ${SECRET}`) =>
  t.fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  });

const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    closures: await ctx.db.query("roadClosures").collect(),
    events: (await ctx.db.query("events").collect()).filter((event) => event.message.startsWith("Apify")).map((event) => event.message),
  }));

describe("POST /apify/road-closures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("APIFY_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("a full closure on our streets is written already snapped, and logged", async () => {
    const t = makeBackend();
    const response = await post(t, { closures: [closure()] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: 1, ignored: 0, closed: 1, duplicates: 0, offOurRoads: 0, reopened: 0 });

    const { closures, events } = await snapshot(t);
    expect(closures).toHaveLength(1);
    expect(closures[0]).toMatchObject({ source: "apify", sourceKey: "caltrans-lcs:LCS-1", confirmed: true, streets: ["Lincoln Avenue"] });
    // Both directions of the block, so the dispatcher's snap leaves it alone.
    expect(closures[0]?.edgeKeys?.length).toBeGreaterThanOrEqual(2);
    expect(events).toEqual(["Apify: road closed on Lincoln Avenue"]);
  });

  test("the same closure posted again is ignored", async () => {
    const t = makeBackend();
    await post(t, { closures: [closure()] });
    expect(await (await post(t, { closures: [closure({ updatedAt: "2026-10-24T13:00:00.000Z" })] })).json()).toMatchObject({ closed: 0, duplicates: 1 });
    expect((await snapshot(t)).closures).toHaveLength(1);
  });

  test("a lifted closure reopens the road", async () => {
    const t = makeBackend();
    await post(t, { closures: [closure()] });
    const lifted = { source: "caltrans-lcs", kind: "road_closure", id: "LCS-1", status: "lifted" };
    expect(await (await post(t, { closures: [lifted] })).json()).toMatchObject({ reopened: 1 });
    const { closures, events } = await snapshot(t);
    expect(closures).toHaveLength(0);
    expect(events).toContain("Apify: Lincoln Avenue reopened");
  });

  test("a lift never reopens a closure someone else made", async () => {
    const t = makeBackend();
    // The manual control on the same block.
    await t.mutation(api.roads.addClosures, { closures: [{ path: LINCOLN_BLOCK.map(([lng, lat]) => ({ lat, lng })), source: "manual" }] });
    const lifted = { source: "caltrans-lcs", kind: "road_closure", id: "LCS-1", status: "lifted" };
    expect(await (await post(t, { closures: [lifted] })).json()).toMatchObject({ reopened: 0 });
    expect((await snapshot(t)).closures).toHaveLength(1);
  });

  test("a closure off our road graph, or one that only crosses our streets, closes nothing", async () => {
    const t = makeBackend();
    const far = closure({ id: "FAR", geometry: { type: "LineString", coordinates: SACRAMENTO } });
    const across = closure({ id: "ACROSS", geometry: { type: "LineString", coordinates: ACROSS_LINCOLN } });
    // The snap used for drawn closures would shut the block this line cuts.
    expect(closedEdgesFor({ path: ACROSS_LINCOLN.map(([lng, lat]) => ({ lat, lng })) }).length).toBeGreaterThan(0);
    expect(await (await post(t, { closures: [far, across] })).json()).toMatchObject({ closed: 0, offOurRoads: 2 });
    expect((await snapshot(t)).closures).toHaveLength(0);
  });

  test("lane closures, zones and bad geometry are ignored", async () => {
    const t = makeBackend();
    const lane = closure({ id: "LANE", status: "open" });
    const zone = closure({ id: "ZONE", kind: "evacuation_zone" });
    const broken = closure({ id: "BROKEN", geometry: { type: "LineString", coordinates: [[-118.15, "x"]] } });
    expect(await (await post(t, { closures: [lane, zone, broken] })).json()).toMatchObject({ received: 3, ignored: 3, closed: 0 });
  });

  test("a wrong secret or a malformed body writes nothing", async () => {
    const t = makeBackend();
    expect((await post(t, { closures: [closure()] }, "Bearer nope")).status).toBe(401);
    expect((await post(t, { zones: [] })).status).toBe(400);
    expect((await snapshot(t)).closures).toHaveLength(0);
  });
});
