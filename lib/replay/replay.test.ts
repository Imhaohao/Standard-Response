import assert from "node:assert/strict";
import { test } from "node:test";
import { countAt, decodeReplay, homeStateAt, ReplayFile, riskStates, vanAt } from "./replay";

const KINDS = ["call", "answer", "noAnswer", "text", "textReply", "doorQueued", "door", "clear", "request", "accepted", "cancel", "arrive", "pickup", "expired", "noRoad", "dropoff"];
const kind = (name: string) => KINDS.indexOf(name);

// Home 0 needs a ride and is picked up on time; home 1 is leaving on its own; home 2 asks for a ride and the hazard
// reaches it first; home 3 needs a ride but is outside the hazard's path.
function sample(): ReplayFile {
  return {
    version: 1,
    city: "test",
    seed: 0,
    fleet: 1,
    warningAt: "2025-01-01T00:00:00Z",
    endS: 3600,
    kinds: KINDS,
    outcomes: ["leaving", "onTime", "late", "missed", "boardedSafe", "notBoardedSafe"],
    homes: {
      lat: [3400000, 3400100, 3400200, 3400300],
      lng: [-11800000, -11800100, -11800200, -11800300],
      need: [1, 0, 2, 1],
      atRisk: [1, 1, 1, 0],
      hazardS: [3000, 3000, 3000, -1],
      deadlineS: [2400, 2400, 2400, -1],
      boardedS: [900, -1, -1, -1],
      outcome: [1, 0, 3, 5],
      arrivalS: [3000, 3000, 3300, -1],
    },
    events: [
      [0, kind("call"), 0, 0],
      [1, kind("call"), 1, 0],
      [200, kind("answer"), 0, 0],
      [200, kind("request"), 0, -1],
      [210, kind("request"), 2, -1],
      [215, kind("request"), 3, -1],
      [240, kind("answer"), 1, 0],
      [240, kind("clear"), 1, -1],
      [300, kind("accepted"), 0, 0],
      [900, kind("pickup"), 0, 0],
      [1500, kind("dropoff"), -1, 0],
    ],
    plans: [[290, 1, 1, 12]],
    vehicles: [{ label: "Van 12-1", kind: "van" }],
    points: [3400000, -11801000, 3400000, -11800000],
    legs: [[0, 300, [0, 1], [0, 400]]],
    staging: { lat: 3400000, lng: -11801000 },
    shelter: { lat: 3399000, lng: -11801000 },
  };
}

test("a home's state follows its events", () => {
  const replay = decodeReplay(sample());
  assert.equal(homeStateAt(replay, 0, -1), "quiet");
  assert.equal(homeStateAt(replay, 0, 100), "calling");
  assert.equal(homeStateAt(replay, 0, 200), "needsRide");
  assert.equal(homeStateAt(replay, 0, 600), "vanComing");
  assert.equal(homeStateAt(replay, 0, 900), "aboard");
  assert.equal(homeStateAt(replay, 1, 500), "leaving");
});

test("a van waits at staging, drives its street path, then parks", () => {
  const replay = decodeReplay(sample());
  assert.deepEqual(vanAt(replay, 0, 100).at, replay.staging);
  const halfway = vanAt(replay, 0, 500);
  assert.equal(halfway.driving, true);
  assert.ok(Math.abs(halfway.at.lng - -118.005) < 1e-9);
  const parked = vanAt(replay, 0, 800);
  assert.equal(parked.driving, false);
  assert.ok(Math.abs(parked.at.lng - -118) < 1e-9);
});

test("the running count moves homes from waiting to out on time, or to missed when the hazard arrives first", () => {
  const replay = decodeReplay(sample());
  assert.deepEqual(countAt(replay, 100), { outOnTime: 0, waiting: 0, missed: 0, atRisk: 2 });
  assert.deepEqual(countAt(replay, 600), { outOnTime: 0, waiting: 2, missed: 0, atRisk: 2 });
  assert.deepEqual(countAt(replay, 1000), { outOnTime: 1, waiting: 1, missed: 0, atRisk: 2 });
  assert.deepEqual(countAt(replay, 3000), { outOnTime: 1, waiting: 1, missed: 0, atRisk: 2 });
  assert.deepEqual(countAt(replay, 3300), { outOnTime: 1, waiting: 0, missed: 1, atRisk: 2 });
});

test("only homes in the hazard's path get a roof, and red roofs match the waiting count at every minute", () => {
  const replay = decodeReplay(sample());
  for (const seconds of [0, 205, 600, 1000, 2999, 3000, 3600]) {
    const states = riskStates(replay, seconds);
    assert.equal(states.has(3), false);
    assert.equal(states.has(1), false);
    const red = [...states.values()].filter((state) => state === "waiting" || state === "vanComing").length;
    assert.equal(red, countAt(replay, seconds).waiting);
  }
});

test("a home turns too late only once the hazard has reached it", () => {
  const replay = decodeReplay(sample());
  const arrival = replay.file.homes.arrivalS ?? [];
  for (let seconds = 0; seconds <= 3600; seconds += 60) {
    for (const [home, state] of riskStates(replay, seconds)) {
      if (state === "missed") assert.ok(arrival[home] >= 0 && arrival[home] <= seconds);
    }
  }
});
