import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CITIES, cityById, localFrame } from "../cities";
import { createProjection } from "./data";
import { buildFireField, scenarioFronts } from "./fire-field";
import type { Scenario } from "./scenario";
import { sampleAt } from "./scenario";
import { fillFit } from "./scene-frames";

test("sampleAt interpolates and holds its ends", () => {
  const level = [
    { minutes: 0, meters: 1 },
    { minutes: 60, meters: 4 },
  ];
  assert.equal(sampleAt(level, -10, (s) => s.meters), 1);
  assert.equal(sampleAt(level, 30, (s) => s.meters), 2.5);
  assert.equal(sampleAt(level, 90, (s) => s.meters), 4);
});

test("fillFit trims a wide fit to a tall screen and keeps the focus inside", () => {
  const fit = { x0: -1700, y0: -1550, x1: 3700, y1: 2800 };
  const tall = fillFit(fit, 9 / 16, [3600, 0]);
  assert.ok(tall.x1 - tall.x0 < fit.x1 - fit.x0);
  assert.equal(tall.y0, fit.y0);
  assert.equal(tall.x1, fit.x1);
  const wide = fillFit(fit, 16 / 9);
  assert.equal(wide.x0, fit.x0);
  assert.ok(wide.y1 - wide.y0 <= fit.y1 - fit.y0);
});

test("Altadena's registry entry reproduces the committed overview and origin", () => {
  const altadena = cityById("altadena");
  assert.equal(CITIES[0], altadena);
  assert.deepEqual(altadena.origin, { lat: 34.189, lng: -118.154 });
  const overview = altadena.frames[0];
  assert.equal(overview.kind, "overview");
  assert.deepEqual(overview.kind === "overview" && overview.fit, { x0: -1700, y0: -1550, x1: 3700, y1: 2800 });
  assert.deepEqual(altadena.files, { map: "/map/altadena.json", terrain: "/map/terrain.bin" });
  const detail = localFrame(altadena.origin, altadena.detail);
  assert.ok(detail.x0 < -2000 && detail.x1 > 4000);
});

test("Altadena's v2 scenario builds the same arrival field as the legacy GeoJSON", () => {
  const scenario = JSON.parse(readFileSync("public/scenarios/altadena.json", "utf8")) as Scenario;
  const legacy = JSON.parse(readFileSync("data/hazard/scenario.geojson", "utf8"));
  const { toLocal } = createProjection(cityById(scenario.city).origin);
  const fromV2 = buildFireField(scenarioFronts(scenario.fronts, toLocal), 64);
  const fromLegacy = buildFireField(scenarioFronts(legacy, toLocal), 64);
  assert.equal(scenario.version, 2);
  assert.equal(scenario.kind, "wildfire");
  assert.deepEqual([...fromV2.minutes], [...fromLegacy.minutes]);
});
