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

  it("advances past the helper question on \"nobody\" even when Claude set no field", async () => {
    const call = readyCall({ "my brother will get me": heard({ exitPlan: "helper", helperRelation: "brother" }) });
    call.step = "exit_plan";
    await call.hear("my brother will get me");
    assert.equal(call.step, "helper");
    await call.hear("Nobody, nobody will.");
    assert.equal(call.step, "note");
    assert.equal(call.answers.exitPlan, "needs_ride");
  });

  it("takes \"no one\" to the exit-plan question as needing a ride", async () => {
    const call = readyCall({});
    call.step = "exit_plan";
    await call.hear("No one. I don't have anyone.");
    assert.equal(call.answers.exitPlan, "needs_ride");
    assert.equal(call.step, "note");
  });
});

describe("questions in Claude's words", () => {
  const ADDRESS = "3060 Olive Avenue";

  function onFile(readings: Record<string, ReadyHeard>) {
    const call = new ReadyCall({
      language: "en",
      addressOnFile: ADDRESS,
      effects: { save: () => {} },
      interpret: async ({ utterance }) => readings[utterance] ?? heard(),
    });
    call.start();
    return call;
  }

  it("speaks Claude's line for the goal the code lands on, with no separate acknowledgment", async () => {
    const line = `Great, thanks. Is ${ADDRESS} still the right address?`;
    const call = onFile({ sure: heard({}, { answer: "yes", acknowledgment: "Thanks.", ask: { goal: "confirm_address", line } }) });
    const turn = await call.hear("sure");
    assert.equal(call.step, "confirm_address");
    assert.deepEqual(turn.sentences, [line]);
    assert.equal(turn.acknowledgment, "");
  });

  it("plays the template when Claude aimed at another goal", async () => {
    const call = onFile({ sure: heard({}, { answer: "yes", ask: { goal: "people", line: "Thanks. How many people live there?" } }) });
    const turn = await call.hear("sure");
    assert.equal(turn.sentences.at(-1), call.readyLines.confirmAddress(ADDRESS));
  });

  it("drops a line that starts with the same word as the agent's last turn", async () => {
    const call = onFile({ sure: heard({}, { answer: "yes", ask: { goal: "confirm_address", line: `This is ${ADDRESS}, right?` } }) });
    const turn = await call.hear("sure");
    assert.equal(turn.sentences.at(-1), call.readyLines.confirmAddress(ADDRESS));
  });

  it("asks a question again in other words, never the same sentence", async () => {
    const call = readyCall({});
    call.step = "people";
    const turn = await call.hear("hmm");
    assert.equal(call.step, "people");
    assert.ok(!turn.sentences.includes(call.readyLines.askPeople));
    assert.equal(turn.sentences.at(-1), call.readyLines.askAgain.people);
  });

  it("moves on at once when the resident doesn't know", async () => {
    const call = readyCall({ "I'm not sure": heard({}, { unsure: true }) });
    call.step = "bedroom";
    await call.hear("I'm not sure");
    assert.equal(call.step, "care");
  });
});
