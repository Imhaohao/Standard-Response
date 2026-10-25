import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LINES, withSafety } from "../agent/script";
import { CutOffApology } from "./apology";

const ANSWER = ["Okay, three people.", "Does anyone use a wheelchair?"];

describe("cut-off apology", () => {
  it("opens the next turn after a real cut-off, in the call language, in the same request", () => {
    const apology = new CutOffApology();
    apology.cutOff();
    assert.deepEqual(apology.open(ANSWER, "en", false), ["Sorry about that.", ...ANSWER]);
    apology.cutOff();
    apology.spokeOther();
    assert.deepEqual(apology.open(["¿Cuántas personas?"], "es", false), [LINES.es.apologyAfterCutOff, "¿Cuántas personas?"]);
  });

  it("says nothing without a cut-off, and only once per cut-off", () => {
    const apology = new CutOffApology();
    assert.deepEqual(apology.open(ANSWER, "en", false), ANSWER);
    apology.cutOff();
    apology.open(ANSWER, "en", false);
    apology.spokeOther();
    assert.deepEqual(apology.open(ANSWER, "en", false), ANSWER);
  });

  it("drops the apology when the cut-off was noise", () => {
    const apology = new CutOffApology();
    apology.cutOff();
    apology.dismiss();
    assert.deepEqual(apology.open(ANSWER, "en", false), ANSWER);
  });

  it("never apologizes on two agent turns in a row", () => {
    const apology = new CutOffApology();
    apology.cutOff();
    assert.equal(apology.open(ANSWER, "en", false)[0], "Sorry about that.");
    apology.cutOff();
    assert.deepEqual(apology.open(ANSWER, "en", false), ANSWER);
    apology.cutOff();
    assert.equal(apology.open(ANSWER, "en", false)[0], "Sorry about that.");
  });

  it("never goes in front of an emergency or safety line", () => {
    const apology = new CutOffApology();
    apology.cutOff();
    assert.deepEqual(apology.open([LINES.en.emergency, ...ANSWER], "en", false), [LINES.en.emergency, ...ANSWER]);
    apology.cutOff();
    const reassigning = withSafety(LINES.en.reassigning, "en");
    assert.deepEqual(apology.open([reassigning], "en", false), [reassigning]);
    apology.cutOff();
    assert.deepEqual(apology.open(ANSWER, "en", true), ANSWER);
  });

  it("has a short apology in every call language", () => {
    for (const lines of Object.values(LINES)) {
      assert.ok(lines.apologyAfterCutOff.length > 0 && lines.apologyAfterCutOff.length <= 20);
    }
  });
});
