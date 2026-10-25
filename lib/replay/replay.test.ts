import assert from "node:assert/strict";
import { test } from "node:test";
import { countAt, decodeReplay, homeStateAt, ReplayFile, vanAt } from "./replay";

const KINDS = ["call", "answer", "noAnswer", "text", "textReply", "doorQueued", "door", "clear", "request", "accepted", "cancel", "arrive", "pickup", "expired", "noRoad", "dropoff"];
const kind = (name: string) => KINDS.indexOf(name);

// Two homes: home 0 needs a ride and is picked up on time; home 1 is leaving on its own.
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
      lat: [3400000, 3400100],
      lng: [-11800000, -11800100],
      need: [1, 0],
      atRisk: [1, 1],
      hazardS: [3000, 3000],
      deadlineS: [2400, 2400],
      boardedS: [900, -1],
      outcome: [1, 0],
    },
    events: [
      [0, kind("call"), 0, 0],
      [1, kind("call"), 1, 0],
      [200, kind("answer"), 0, 0],
      [200, kind("request"), 0, -1],
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

test("the running count moves a home from waiting to out on time at its pickup", () => {
  const replay = decodeReplay(sample());
  assert.deepEqual(countAt(replay, 100), { outOnTime: 0, waiting: 0, atRisk: 1 });
  assert.deepEqual(countAt(replay, 600), { outOnTime: 0, waiting: 1, atRisk: 1 });
  assert.deepEqual(countAt(replay, 1000), { outOnTime: 1, waiting: 0, atRisk: 1 });
});
