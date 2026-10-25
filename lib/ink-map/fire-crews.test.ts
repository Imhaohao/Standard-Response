import assert from "node:assert/strict";
import { test } from "node:test";
import { Point } from "./data";
import { crewAt, CrewHome, CrewRun, CrewStart, doorStates, planCrews, QueueSnapshot, SAFETY_MINUTES, visitedBy } from "./fire-crews";

// A straight street between any two points, so drive times are easy to reason about: 100 m a minute.
const straight = (from: Point, to: Point): Point[] => [from, to];
const SPEED = 100;

const start = (engine: string, at: Point, leavesAt = 0): CrewStart => ({ engine, station: `${engine} station`, at, leavesAt, joinsAtEdge: false });
const home = (id: string, at: Point, fireMinutes = Infinity, dwellMinutes = 4): CrewHome => ({ id, at, fireMinutes, dwellMinutes });
// The list as it stands from the warning on, top first.
const listed = (...homes: CrewHome[]): QueueSnapshot[] => [{ fromMinutes: 0, homes }];
const order = (run: CrewRun) => run.visits.map((visit) => visit.home);

test("a crew takes the list from the top, not the nearest home or the soonest fire", () => {
  const queue = listed(home("first", [900, 0], 200), home("second", [100, 0], 24), home("third", [50, 0], 25));
  const [run] = planCrews([start("E1", [0, 0])], queue, straight, SPEED);
  assert.deepEqual(order(run), ["first"], "second and third burn before it gets back to them");
  const roomy = listed(home("first", [900, 0]), home("second", [100, 0]), home("third", [50, 0]));
  assert.deepEqual(order(planCrews([start("E1", [0, 0])], roomy, straight, SPEED)[0]), ["first", "second", "third"]);
});

test("a home is passed only when the crew can't reach it and leave before the fire", () => {
  // Due at 10: 9 minutes of driving and 4 at the door would leave at 13, past the 3-minute margin.
  const queue = listed(home("too-late", [900, 0], 10), home("next", [100, 0], 60));
  const [run] = planCrews([start("E1", [0, 0])], queue, straight, SPEED);
  assert.deepEqual(order(run), ["next"]);
  assert.deepEqual(new Set(run.passed.map((passed) => passed.home)), new Set(["too-late"]));
  assert.deepEqual(doorStates([run], 0).get("too-late"), { kind: "passed" });
});

test("across a busy night, every home passed over really was out of reach", () => {
  const homes = Array.from({ length: 30 }, (_, i) => home(`h${String(i).padStart(2, "0")}`, [((i * 7) % 6) * 300, Math.floor(i / 6) * 300], 20 + ((i * 11) % 30) * 3));
  const runs = planCrews([start("E1", [0, 0]), start("E2", [1500, 1200], 5)], listed(...homes), straight, SPEED);
  const visits = runs.flatMap((run) => run.visits);
  assert.ok(visits.length > 0);
  for (const visit of visits) assert.ok(visit.leaveMinutes <= visit.fireMinutes - SAFETY_MINUTES, `${visit.home} left at ${visit.leaveMinutes}, fire at ${visit.fireMinutes}`);
  assert.equal(new Set(visits.map((visit) => visit.home)).size, visits.length, "no home is visited twice");
  assert.ok(runs.some((run) => run.passed.length > 0), "the night has homes to pass");
  for (const run of runs) {
    for (const passed of run.passed) {
      const target = homes.find((candidate) => candidate.id === passed.home)!;
      const from = crewAt(run, passed.atMinutes).at;
      const arrive = passed.atMinutes + Math.hypot(target.at[0] - from[0], target.at[1] - from[1]) / SPEED;
      assert.ok(arrive + target.dwellMinutes > target.fireMinutes - SAFETY_MINUTES, `${passed.home} was reachable at ${passed.atMinutes}`);
    }
  }
});

test("each pick is the highest listed home nobody has taken that the crew can still make", () => {
  const homes = Array.from({ length: 12 }, (_, i) => home(`h${i}`, [(i * 337) % 1500, (i * 211) % 1500], 25 + ((i * 13) % 50)));
  const runs = planCrews([start("E1", [0, 0]), start("E2", [1500, 1500])], listed(...homes), straight, SPEED);
  assert.ok(runs.some((run) => run.passed.length > 0), "some picks go below the top");
  const sends = runs.flatMap((run) => run.visits.map((visit) => ({ run, visit }))).sort((a, b) => a.visit.sentMinutes - b.visit.sentMinutes);
  for (const { run, visit } of sends) {
    // Another crew sent at the same minute may have picked first, so its home counts as taken.
    const takenBefore = new Set(sends.filter((other) => other.visit.sentMinutes < visit.sentMinutes || (other.visit.sentMinutes === visit.sentMinutes && other.run !== run)).map((other) => other.visit.home));
    const above = homes.slice(0, homes.findIndex((candidate) => candidate.id === visit.home));
    const passedThen = new Set(run.passed.filter((passed) => passed.atMinutes === visit.sentMinutes).map((passed) => passed.home));
    for (const skipped of above) if (!takenBefore.has(skipped.id)) assert.ok(passedThen.has(skipped.id), `${run.engine} jumped ${skipped.id} for ${visit.home}`);
  }
});

test("an empty list leaves every crew at its station", () => {
  const runs = planCrews([start("E1", [0, 0], 2), start("E2", [500, 0], 2)], listed(), straight, SPEED);
  for (const run of runs) {
    assert.equal(run.legs.length, 0);
    const moment = crewAt(run, 30);
    assert.equal(moment.kind, "idle");
    if (moment.kind === "idle") assert.ok(moment.atStation);
  }
});

test("a home joining the list sends a waiting crew out from its station at that minute", () => {
  const queue: QueueSnapshot[] = [
    { fromMinutes: 0, homes: [] },
    { fromMinutes: 20, homes: [home("late", [300, 0], 90)] },
  ];
  const [run] = planCrews([start("E1", [0, 0], 2)], queue, straight, SPEED);
  assert.equal(crewAt(run, 10).kind, "idle");
  assert.deepEqual(run.visits[0], { home: "late", at: [300, 0], sentMinutes: 20, arriveMinutes: 23, leaveMinutes: 27, fireMinutes: 90 });
});

test("a list change never pulls a crew off the door it is driving to or working", () => {
  const before: QueueSnapshot[] = listed(home("a", [1000, 0]), home("b", [0, 1000]), home("c", [500, 500]));
  // At minute 12 the crew is at a (10 minutes out, 4 at the door). The list drops a, reorders and adds d.
  const after: QueueSnapshot[] = [...before, { fromMinutes: 12, homes: [home("d", [1000, 100]), home("c", [500, 500]), home("b", [0, 1000])] }];
  const [once] = planCrews([start("E1", [0, 0])], before, straight, SPEED);
  const [again] = planCrews([start("E1", [0, 0])], after, straight, SPEED);
  assert.deepEqual(once.visits[0], again.visits[0], "a is finished as planned");
  assert.deepEqual(crewAt(once, 12), crewAt(again, 12));
  assert.deepEqual(order(once), ["a", "b", "c"]);
  assert.deepEqual(order(again), ["a", "d", "c", "b"], "only the next pick follows the new list");
});

test("a crew heading back to its station turns around when a home joins", () => {
  const queue: QueueSnapshot[] = [
    { fromMinutes: 0, homes: [home("a", [1000, 0])] },
    { fromMinutes: 17, homes: [home("a", [1000, 0]), home("b", [1000, 200])] },
  ];
  const [run] = planCrews([start("E1", [0, 0])], queue, straight, SPEED);
  // At a from 10 to 14, back toward the station from 14, turned around 300 m along at 17.
  assert.deepEqual(run.legs[1].path, [
    [1000, 0],
    [700, 0],
  ]);
  assert.equal(run.legs[1].endMinutes, 17);
  assert.equal(run.visits[1].home, "b");
  assert.equal(run.visits[1].sentMinutes, 17);
});

test("several free crews split the list, the nearest taking the top home", () => {
  const queue = listed(home("a", [5000, 0]), home("b", [100, 0]), home("c", [5100, 0]), home("d", [200, 0]));
  const runs = planCrews([start("west", [0, 0]), start("east", [5000, 100])], queue, straight, SPEED);
  const byCrew = Object.fromEntries(runs.map((run) => [run.engine, order(run)]));
  assert.deepEqual(byCrew, { west: ["b", "d"], east: ["a", "c"] });
  for (const run of runs) {
    for (const [i, leg] of run.legs.entries()) {
      const from = i === 0 ? run.at : run.visits[i - 1].at;
      assert.deepEqual(leg.path[0], from);
    }
  }
});

test("the same list and fire always plan the same night", () => {
  const homes = Array.from({ length: 20 }, (_, i) => home(`h${i}`, [(i * 137) % 1000, (i * 251) % 1000], 30 + ((i * 7) % 40)));
  const starts = [start("E1", [0, 0]), start("E2", [1000, 1000])];
  assert.deepEqual(planCrews(starts, listed(...homes), straight, SPEED), planCrews(starts, listed(...homes), straight, SPEED));
});

test("playback: at the station, driving the street, stopped at the door, then back", () => {
  const [run] = planCrews([start("E1", [0, 0], 2)], listed(home("h", [500, 0], 60, 6)), straight, SPEED);
  assert.equal(crewAt(run, 1).kind, "idle");
  const driving = crewAt(run, 4.5);
  assert.equal(driving.kind, "driving");
  assert.deepEqual(driving.at, [250, 0]);
  if (driving.kind === "driving") assert.equal(driving.to?.home, "h");
  const helping = crewAt(run, 10);
  assert.equal(helping.kind, "helping");
  if (helping.kind === "helping") assert.equal(helping.progress, 0.5);
  assert.deepEqual(doorStates([run], 10).get("h"), { kind: "sent", engine: "E1" });
  assert.equal(visitedBy([run], 12).length, 0);
  assert.equal(visitedBy([run], 13).length, 1);
  assert.deepEqual(doorStates([run], 13).get("h"), { kind: "knocked", engine: "E1" });
  const homeward = crewAt(run, 15);
  assert.equal(homeward.kind, "driving");
  if (homeward.kind === "driving") assert.equal(homeward.to, null);
  const after = crewAt(run, 30);
  assert.deepEqual(after, { kind: "idle", at: [0, 0], atStation: true }, "drives back to the station when the list has nothing left");
});

test("a home no street reaches is passed", () => {
  const noRoadTo = (from: Point, to: Point) => (to[0] === 999 ? null : straight(from, to));
  const [run] = planCrews([start("E1", [0, 0])], listed(home("island", [999, 0], 60), home("h", [100, 0], 90)), noRoadTo, SPEED);
  assert.deepEqual(order(run), ["h"]);
});
