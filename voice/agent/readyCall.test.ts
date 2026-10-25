import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReadyCall } from "./readyCall";
import type { ReadyHeard, ReadyUpdates } from "./readyInterpreter";

// The Ready check's steps on their own: each utterance maps to what Claude would have read.

function heard(updates: ReadyUpdates = {}, overrides: Partial<ReadyHeard> = {}): ReadyHeard {
  return {
    answer: null,
    updates,
    emergency: false,
    asksAboutRide: false,
    wantsRepeat: false,
    wantsToEnd: false,
    addressedToAgent: true,
    acknowledgment: "",
    ...overrides,
  };
}

function readyCall(readings: Record<string, ReadyHeard>) {
  const call = new ReadyCall({
    language: "en",
    effects: { save: () => {} },
    interpret: async ({ utterance }) => readings[utterance] ?? heard(),
  });
  call.start();
  return call;
}

describe("the exit plan", () => {
  // Jerry at 3060 Olive Avenue: "Nobody, nobody will." and three more like it, each answered with
  // "Who would pick you up, and what's their phone number?"
  it("moves on when the resident says nobody would pick them up", async () => {
    const call = readyCall({
      "my brother will get me": heard({ exitPlan: "helper", helperRelation: "brother" }),
      "Nobody, nobody will.": heard({ exitPlan: "needs_ride" }),
    });
    call.step = "exit_plan";
    await call.hear("my brother will get me");
    assert.equal(call.step, "helper");
    const nobody = await call.hear("Nobody, nobody will.");
    assert.equal(call.step, "note");
    assert.ok(!nobody.sentences.includes("Sorry, I didn't catch that."));
  });
});
