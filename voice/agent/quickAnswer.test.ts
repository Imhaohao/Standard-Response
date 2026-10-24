import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quickReading } from "./quickAnswer";

describe("the quick yes-or-no reading", () => {
  it("reads a bare yes at the address confirmation", () => {
    assert.equal(quickReading("Yes.", "confirm_address", "en")?.answer, "yes");
    assert.equal(quickReading("Sí.", "confirm_address", "es")?.answer, "yes");
  });

  it("records can-leave from a bare answer to that question", () => {
    assert.deepEqual(quickReading("No.", "can_leave", "en")?.updates, { canLeave: "no" });
  });

  it("leaves anything more than a bare word to Claude", () => {
    assert.equal(quickReading("Yes, but my son is here too.", "readback", "en"), null);
    assert.equal(quickReading("No! I can't get out!", "can_leave", "en"), null);
  });

  it("leaves steps where a bare word is ambiguous to Claude", () => {
    assert.equal(quickReading("Yes.", "needs", "en"), null);
    assert.equal(quickReading("Yes.", "assistance", "en"), null);
    assert.equal(quickReading("Yes.", "hold", "en"), null);
  });

  it("reads the line check, the head count alone and an okay on hold", () => {
    assert.equal(quickReading("Hello? Hello?", "ask_address", "en")?.wantsRepeat, true);
    assert.deepEqual(quickReading("Just me.", "household", "en")?.updates, { peopleCount: 1 });
    assert.equal(quickReading("Okay, thank you.", "hold", "en")?.wantsToEnd, false);
    assert.equal(quickReading("Okay.", "readback", "en"), null);
  });

  it("leaves languages without a reviewed word list to Claude", () => {
    assert.equal(quickReading("是", "confirm_address", "zh"), null);
  });
});
