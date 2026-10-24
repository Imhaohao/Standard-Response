/// <reference types="vite/client" />
// Run from the repo root: npx vitest run apify/tests --environment edge-runtime
import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts");

const SECRET = "test-secret";
const ENDPOINT = "/apify/zone-status";

// A square over west Altadena, GeoJSON order [longitude, latitude].
const SQUARE = [
  [
    [-118.16, 34.18],
    [-118.14, 34.18],
    [-118.14, 34.2],
    [-118.16, 34.2],
    [-118.16, 34.18],
  ],
];
const FAR_AWAY_SQUARE = [
  [
    [-121.5, 38.5],
    [-121.4, 38.5],
    [-121.4, 38.6],
    [-121.5, 38.6],
    [-121.5, 38.5],
  ],
];

const zone = (overrides: Record<string, unknown> = {}) => ({
  source: "cal-oes",
  sourceUrl: "https://example.test/layer",
  kind: "evacuation_zone",
  id: "ZONE-1",
  name: "Zone A",
  county: "Los Angeles",
  status: "warning",
  updatedAt: "2026-10-24T12:00:00.000Z",
  geometry: { type: "Polygon", coordinates: SQUARE },
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

async function addRider(t: Backend, lat: number, lng: number) {
  return await t.run(async (ctx) =>
    ctx.db.insert("households", {
      address: "1 Test St",
      lat,
      lng,
      callbackNumber: `+1555${Math.round(Math.abs(lat * lng) * 1000)}`,
      language: "en",
      callStatus: "not_called",
      outcome: "unknown",
      inZone: false,
      attempts: 0,
      needPrior: 0.5,
      needProbability: 0.5,
      fireArrivalAt: Date.now() + 60 * 60_000,
      callPriority: 1,
      simulated: false,
    }),
  );
}

const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    control: await ctx.db.query("control").first(),
    zones: await ctx.db.query("zones").collect(),
    apifyZones: await ctx.db.query("apifyZones").collect(),
    events: (await ctx.db.query("events").collect()).filter((event) => event.message.startsWith("Apify")),
    warningLogged: (await ctx.db.query("events").collect()).filter((event) => event.message.startsWith("Evacuation warning issued")),
  }));

describe("POST /apify/zone-status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("APIFY_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("a warning zone with a rider inside starts Rider Check once and logs it", async () => {
    const t = makeBackend();
    const riderId = await addRider(t, 34.19, -118.15);
    const response = await post(t, { zones: [zone()] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: 1, duplicates: 0, noRiders: 0, ridersInside: 1, warningStarted: true });

    const after = await snapshot(t);
    expect(after.control?.warningIssuedAt).toBeTypeOf("number");
    expect(after.control?.dialerRunning).toBe(true);
    expect(after.zones).toHaveLength(1);
    expect(after.apifyZones).toHaveLength(1);
    expect(after.events.map((event) => event.message)).toEqual(["Apify: Zone A went to warning, 1 riders inside"]);
    expect(after.warningLogged).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get("households", riderId)))?.inZone).toBe(true);
  });

  test("the same zone id and status again is a no-op", async () => {
    const t = makeBackend();
    await addRider(t, 34.19, -118.15);
    await post(t, { zones: [zone()] });
    const first = await snapshot(t);

    const response = await post(t, { zones: [zone()] });
    expect(await response.json()).toMatchObject({ applied: 0, duplicates: 1, warningStarted: false });

    const second = await snapshot(t);
    expect(second.control?.warningIssuedAt).toBe(first.control?.warningIssuedAt);
    expect(second.control?.tickGeneration).toBe(first.control?.tickGeneration);
    expect(second.zones).toHaveLength(1);
    expect(second.apifyZones).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    expect(second.warningLogged).toHaveLength(1);
  });

  test("an escalation from warning to order updates the zone without a second warning", async () => {
    const t = makeBackend();
    await addRider(t, 34.19, -118.15);
    await post(t, { zones: [zone()] });
    const first = await snapshot(t);

    const response = await post(t, { zones: [zone({ status: "order" })] });
    expect(await response.json()).toMatchObject({ applied: 1, warningStarted: false });

    const second = await snapshot(t);
    expect(second.apifyZones).toHaveLength(1);
    expect(second.apifyZones[0]?.status).toBe("order");
    expect(second.control?.warningIssuedAt).toBe(first.control?.warningIssuedAt);
    expect(second.warningLogged).toHaveLength(1);
    expect(second.events.map((event) => event.message)).toContain("Apify: Zone A went to order, 1 riders inside");
  });

  test("a second zone keeps riders of the first zone covered", async () => {
    const t = makeBackend();
    const insideFirst = await addRider(t, 34.19, -118.15);
    const insideSecond = await addRider(t, 38.55, -121.45);
    await post(t, { zones: [zone()] });
    await post(t, { zones: [zone({ id: "ZONE-2", name: "Zone B", geometry: { type: "Polygon", coordinates: FAR_AWAY_SQUARE } })] });

    const flags = await t.run(async (ctx) => [(await ctx.db.get("households", insideFirst))?.inZone, (await ctx.db.get("households", insideSecond))?.inZone]);
    expect(flags).toEqual([true, true]);
  });

  test("a wrong secret is rejected and changes nothing", async () => {
    const t = makeBackend();
    await addRider(t, 34.19, -118.15);
    expect((await post(t, { zones: [zone()] }, "Bearer wrong")).status).toBe(401);
    expect((await post(t, { zones: [zone()] }, null)).status).toBe(401);
    expect((await post(t, { zones: [zone()] }, SECRET)).status).toBe(401);

    const after = await snapshot(t);
    expect(after.control).toBeNull();
    expect(after.apifyZones).toHaveLength(0);
    expect(after.events).toHaveLength(0);
  });

  test("every request is rejected while the secret is unset", async () => {
    vi.stubEnv("APIFY_WEBHOOK_SECRET", "");
    const t = makeBackend();
    await addRider(t, 34.19, -118.15);
    expect((await post(t, { zones: [zone()] }, "Bearer ")).status).toBe(401);
    expect((await post(t, { zones: [zone()] }, `Bearer ${SECRET}`)).status).toBe(401);
    expect((await snapshot(t)).control).toBeNull();
  });

  test("a zone with no riders inside does nothing", async () => {
    const t = makeBackend();
    await addRider(t, 34.19, -118.15);
    const response = await post(t, { zones: [zone({ geometry: { type: "Polygon", coordinates: FAR_AWAY_SQUARE } })] });
    expect(await response.json()).toMatchObject({ applied: 0, noRiders: 1, warningStarted: false });

    const after = await snapshot(t);
    expect(after.control).toBeNull();
    expect(after.zones).toHaveLength(0);
    expect(after.apifyZones).toHaveLength(0);
    expect(after.events).toHaveLength(0);
  });

  test("zones that are not warning or order polygons are ignored, and a bad body is a 400", async () => {
    const t = makeBackend();
    await addRider(t, 34.19, -118.15);
    const ignored = zone({ id: "Z-ADVISORY", status: "advisory" });
    const pointZone = zone({ id: "Z-POINT", geometry: { type: "Point", coordinates: [-118.15, 34.19] } });
    const response = await post(t, { zones: [ignored, pointZone] });
    expect(await response.json()).toMatchObject({ received: 2, ignored: 2, applied: 0 });
    expect((await snapshot(t)).control).toBeNull();

    expect((await post(t, { nope: true })).status).toBe(400);
  });
});
