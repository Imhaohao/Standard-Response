import { test } from "node:test";
import assert from "node:assert/strict";
import { areaTargets } from "../../convex/truckDrill";
import { runTruck } from "../../convex/truckRun";
import { ENGINE } from "../../convex/vehicleRun";

const STATION = { lat: 34.1916, lng: -118.1586 };
const SHELTER = { lat: 34.1443, lng: -118.1446 };
const home = (lat: number, lng: number, fireMinutes: number) => ({ address: `${lat},${lng}`, at: { lat, lng }, people: 1, boardingSeconds: 120, fireSeconds: fireMinutes * 60 });

test("one engine misses residents in the simulated area, and the sweep says how many it would take", () => {
  const targets = areaTargets("wildfire");
  const run = runTruck(STATION, SHELTER, targets, ENGINE);
  const counts = { rescued: 0, too_late: 0, never_reached: 0 };
  for (const result of run.homes) counts[result.outcome] += 1;
  console.log(targets.length, "homes", counts, "trucks needed", run.trucksNeeded, "end minute", Math.round(run.endSeconds / 60));
  assert.ok(counts.rescued > 0);
  assert.ok(counts.too_late + counts.never_reached > 0);
  assert.ok(run.trucksNeeded === null || run.trucksNeeded > 1);
});

test("a home with time to spare is boarded and unloaded at the shelter", () => {
  const run = runTruck(STATION, SHELTER, [home(34.19, -118.155, 300)]);
  assert.equal(run.homes[0].outcome, "rescued");
  assert.deepEqual(run.stops.map((stop) => stop.kind), ["board", "unload"]);
  assert.ok(run.legs.length === 2 && run.legs[1].startSeconds >= run.stops[0].atSeconds + 120);
  assert.equal(run.trucksNeeded, 1);
});

test("a home the fire reaches before any truck could is not rescued", () => {
  const run = runTruck(STATION, SHELTER, [home(34.19, -118.155, 300), home(34.198, -118.145, 1)]);
  assert.equal(run.homes[0].outcome, "rescued");
  assert.notEqual(run.homes[1].outcome, "rescued");
  assert.equal(run.trucksNeeded, null);
});

test("a household bigger than the cab rides in trips", () => {
  const big = { ...home(34.19, -118.155, 600), people: 5 };
  const run = runTruck(STATION, SHELTER, [big], { speedMph: 20, seats: 2 });
  assert.equal(run.stops.filter((stop) => stop.kind === "board").length, 3);
  assert.equal(run.stops.filter((stop) => stop.kind === "unload").length, 3);
  assert.equal(run.homes[0].outcome, "rescued");
});
