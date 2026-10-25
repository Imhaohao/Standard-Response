import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AskCheck, checkAsk } from "./askLine";

const HOUSEHOLD: AskCheck = { goal: "household", templates: ["How many people are with you right now? Are there any pets?"], language: "en", said: [] };

describe("Claude's next question", () => {
  it("plays when it asks its goal in fresh words", () => {
    assert.equal(checkAsk({ goal: "household", line: "Thanks for that. Who's in the house with you right now?" }, HOUSEHOLD).line, "Thanks for that. Who's in the house with you right now?");
  });

  it("never asks whether a resident who just spoke is still there", () => {
    assert.equal(checkAsk({ goal: "household", line: "I'm listening. Are you still there? Who's with you right now?" }, HOUSEHOLD).line, null);
    assert.equal(checkAsk({ goal: "household", line: "Can you hear me? Who's with you right now?" }, HOUSEHOLD).line, null);
  });
});
