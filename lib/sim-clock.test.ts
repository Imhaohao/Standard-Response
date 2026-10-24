import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockAtSpeed, runningMs, simTime } from "./sim-clock";

describe("the night's clock", () => {
  it("reads the wall clock until someone changes the speed", () => {
    assert.equal(simTime(undefined, 5_000), 5_000);
  });

  it("runs ahead at the speed it was set to, from where it was", () => {
    const fast = clockAtSpeed(undefined, 10, 1_000);
    assert.equal(simTime(fast, 3_000), 1_000 + 2_000 * 10);
  });

  it("stands still while paused, and the pause doesn't count as running time", () => {
    const fast = clockAtSpeed(undefined, 10, 1_000);
    const paused = clockAtSpeed(fast, 0, 3_000);
    assert.equal(simTime(paused, 60_000), 21_000);
    assert.equal(runningMs(paused, 60_000), 2_000);
    const resumed = clockAtSpeed(paused, 1, 60_000);
    assert.equal(simTime(resumed, 61_000), 22_000);
    assert.equal(runningMs(resumed, 61_000), 3_000);
  });
});
