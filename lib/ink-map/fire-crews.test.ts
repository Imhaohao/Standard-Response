import assert from "node:assert/strict";
import { test } from "node:test";
import { Point } from "./data";
import { crewAt, CrewHome, CrewStart, planCrews, visitedBy } from "./fire-crews";

// A straight street between any two points, so drive times are easy to reason about: 100 m a minute.
const straight = (from: Point, to: Point): Point[] => [from, to];
const SPEED = 100;

const start = (engine: string, at: Point, leavesAt = 0): CrewStart => ({ engine, station: `${engine} station`, at, leavesAt, joinsAtEdge: false });
const home = (id: string, at: Point, fireMinutes: number, need = 0.5, dwellMinutes = 4): CrewHome => ({ id, at, fireMinutes, dwellMinutes, need });

test("a crew goes to the home the fire reaches first, not the nearest", () => {
  const [run] = planCrews([start("E1", [0, 0])], [home("near", [100, 0], 120), home("far", [800, 0], 30)], straight, SPEED);
  assert.deepEqual(
    run.visits.map((visit) => visit.home),
    ["far", "near"],
  );
});

test("every visit ends before the fire arrives, with time to spare", () => {
  const homes = Array.from({ length: 30 }, (_, i) => home(`h${String(i).padStart(2, "0")}`, [(i % 6) * 300, Math.floor(i / 6) * 300], 20 + i * 3));
  const runs = planCrews([start("E1", [0, 0]), start("E2", [1500, 1200], 5)], homes, straight, SPEED);
  const visits = runs.flatMap((run) => run.visits);
  assert.ok(visits.length > 0);
  for (const visit of visits) assert.ok(visit.leaveMinutes <= visit.fireMinutes - 3, `${visit.home} left at ${visit.leaveMinutes}, fire at ${visit.fireMinutes}`);
  assert.equal(new Set(visits.map((visit) => visit.home)).size, visits.length, "no home is visited twice");
});

test("a home no crew can reach in time is left out", () => {
  const [run] = planCrews([start("E1", [0, 0], 2)], [home("doomed", [3000, 0], 10)], straight, SPEED);
  assert.equal(run.visits.length, 0);
});

test("between two homes due at once, the one that needs more help goes first", () => {
  const [run] = planCrews([start("E1", [0, 0])], [home("walks", [300, 0], 90, 0.1), home("wheelchair", [0, 300], 90, 1.4)], straight, SPEED);
  assert.equal(run.visits[0].home, "wheelchair");
});

test("several crews split the homes and each drives from where it last stopped", () => {
  const homes = [home("a", [100, 0], 60), home("b", [5000, 0], 60), home("c", [200, 0], 70), home("d", [5100, 0], 70)];
  const runs = planCrews([start("west", [0, 0]), start("east", [5000, 100])], homes, straight, SPEED);
  const byCrew = Object.fromEntries(runs.map((run) => [run.engine, run.visits.map((visit) => visit.home).sort()]));
  assert.deepEqual(byCrew, { west: ["a", "c"], east: ["b", "d"] });
  for (const run of runs) {
    for (const [i, leg] of run.legs.entries()) {
      const from = i === 0 ? run.at : run.visits[i - 1].at;
      assert.deepEqual(leg.path[0], from);
    }
  }
});

test("the same night plans the same way whatever order the homes come in", () => {
  const homes = Array.from({ length: 20 }, (_, i) => home(`h${i}`, [(i * 137) % 1000, (i * 251) % 1000], 30 + ((i * 7) % 40)));
  const starts = [start("E1", [0, 0]), start("E2", [1000, 1000])];
  const once = planCrews(starts, homes, straight, SPEED);
  const again = planCrews(starts, [...homes].reverse(), straight, SPEED);
  assert.deepEqual(once, again);
});

test("playback: waiting at the station, driving the street, stopped at the door, then done", () => {
  const [run] = planCrews([start("E1", [0, 0], 2)], [home("h", [500, 0], 60, 0.5, 6)], straight, SPEED);
  assert.equal(crewAt(run, 1).kind, "waiting");
  const driving = crewAt(run, 4.5);
  assert.equal(driving.kind, "driving");
  assert.deepEqual(driving.at, [250, 0]);
  if (driving.kind === "driving") assert.equal(driving.to?.home, "h");
  const helping = crewAt(run, 10);
  assert.equal(helping.kind, "helping");
  if (helping.kind === "helping") assert.equal(helping.progress, 0.5);
  assert.equal(visitedBy([run], 12).length, 0);
  assert.equal(visitedBy([run], 13).length, 1);
  const after = crewAt(run, 30);
  assert.equal(after.kind, "done");
  assert.deepEqual(after.at, [0, 0], "drives back to the station when nothing is left");
});

test("a home no street reaches is skipped", () => {
  const noRoadTo = (from: Point, to: Point) => (to[0] === 999 ? null : straight(from, to));
  const [run] = planCrews([start("E1", [0, 0])], [home("island", [999, 0], 60), home("h", [100, 0], 90)], noRoadTo, SPEED);
  assert.deepEqual(
    run.visits.map((visit) => visit.home),
    ["h"],
  );
});
