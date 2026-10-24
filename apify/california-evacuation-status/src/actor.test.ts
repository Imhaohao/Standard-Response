import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDrillRecord } from "./drill.js";
import { applyFilters, dedupeZones } from "./filters.js";
import { isStale, normalizeZoneStatus } from "./status.js";
import type { EvacuationRecord } from "./types.js";
import { planWebhook } from "./webhook.js";

const square: [number, number][] = [
  [-118.16, 34.18],
  [-118.14, 34.18],
  [-118.14, 34.2],
];

const zone = (overrides: Partial<EvacuationRecord> = {}): EvacuationRecord => ({
  source: "cal-oes",
  sourceUrl: "https://example.test",
  kind: "evacuation_zone",
  id: "US-CA-XLA-ALT-E001",
  name: "Zone",
  county: "Los Angeles",
  status: "warning",
  updatedAt: "2026-10-24T12:00:00.000Z",
  stale: false,
  geometry: { type: "Polygon", coordinates: [[...square, square[0] as [number, number]]] },
  properties: {},
  ...overrides,
});

test("zone statuses normalize", () => {
  assert.equal(normalizeZoneStatus("Evacuation Order"), "order");
  assert.equal(normalizeZoneStatus("Evacuation Warning"), "warning");
  assert.equal(normalizeZoneStatus("Shelter in Place"), "advisory");
  assert.equal(normalizeZoneStatus("Evacuation Order(s) Lifted"), "lifted");
  assert.equal(normalizeZoneStatus(null), "unknown");
});

test("staleness uses the source edit time", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  assert.equal(isStale("2023-09-20T00:00:00Z", now, 72), true);
  assert.equal(isStale("2026-10-24T00:00:00Z", now, 72), false);
  assert.equal(isStale(null, now, 72), true);
});

test("county and box filters", () => {
  const records = [zone(), zone({ id: "b", county: "Kern" })];
  assert.equal(applyFilters(records, ["los angeles county"], undefined).length, 1);
  assert.equal(applyFilters(records, [], { west: -119, south: 33, east: -117, north: 35 }).length, 2);
  assert.equal(applyFilters(records, [], { west: -100, south: 33, east: -99, north: 35 }).length, 0);
});

test("the same zone in two layers is kept once", () => {
  const oes = zone();
  const calFire = zone({ source: "cal-fire-zones", id: "ALT-E001" });
  assert.deepEqual(dedupeZones([oes, calFire]).map((record) => record.source), ["cal-oes"]);
});

test("webhook sends only new or changed alerting zones and forgets zones that left", () => {
  const first = planWebhook([zone()], {}, new Set(["cal-oes"]));
  assert.equal(first.pending.length, 1);
  const sent = { [first.pending[0]!.key]: first.pending[0]!.fingerprint };
  assert.equal(planWebhook([zone()], sent, new Set(["cal-oes"])).pending.length, 0);
  assert.equal(planWebhook([zone({ status: "order" })], sent, new Set(["cal-oes"])).pending.length, 1);
  assert.deepEqual(planWebhook([zone({ status: "lifted" })], sent, new Set(["cal-oes"])).retained, {});
  assert.deepEqual(planWebhook([], sent, new Set()).retained, sent);
  assert.equal(planWebhook([zone({ stale: true })], {}, new Set(["cal-oes"])).pending.length, 0);
});

test("drill records are labelled", () => {
  const record = buildDrillRecord(square, "Practice", new Date("2026-10-24T05:00:00Z"));
  assert.equal(record.drill, true);
  assert.equal(record.status, "warning");
  assert.equal(record.geometry.type, "Polygon");
});
