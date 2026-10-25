import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withoutRepeatedSentences } from "./sentences";

describe("withoutRepeatedSentences", () => {
  it("drops a sentence said earlier in the turn and keeps everything else as written", () => {
    const lines = ["Nothing has changed since I last told you. I'll tell you the moment it does.", "Nothing has changed since I last told you.", "Are you at 12 N. Lake Ave right now?"];
    assert.deepEqual(withoutRepeatedSentences(lines), [lines[0], "", lines[2]]);
  });

  it("compares sentences without case or punctuation", () => {
    assert.deepEqual(withoutRepeatedSentences(["Thank you.", "Thank you! Goodbye."]), ["Thank you.", "Goodbye."]);
  });

  it("splits sentences in languages that end them without a space", () => {
    assert.deepEqual(withoutRepeatedSentences(["还没有变化。", "还没有变化。一有变化，我马上告诉您。"]), ["还没有变化。", "一有变化，我马上告诉您。"]);
  });

  it("leaves lines with no repeats untouched", () => {
    const lines = ["", "Okay.", "How many people are with you right now? Are there any pets?"];
    assert.deepEqual(withoutRepeatedSentences(lines), lines);
  });
});
