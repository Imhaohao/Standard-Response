import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guardAcknowledgment } from "./honesty";

// Lines the voice exam's judge flagged as implying help is coming while no driver had accepted.
const CAUGHT = [
  ["en", "We hear you, and we are working on getting help to you."],
  ["en", "Your dog's needs will be part of the plan, so the crew knows to bring what's needed."],
  ["en", "Your dad is trying to fight the fire, and I want to make sure the right help gets to you."],
  ["en", "Yes, your address is on the list, and the dispatchers can see that."],
  ["es", "Estamos trabajando para ayudarle."],
  ["es", "Seguimos con usted."],
  ["es", "Está bien, no pasa nada."],
  ["en", "The evacuation question is being handled by the dispatchers."],
] as const;

describe("the honesty guard", () => {
  for (const [language, line] of CAUGHT) {
    it(`drops "${line}" while no driver has accepted`, () => {
      assert.equal(guardAcknowledgment(line, "received", language).blocked, true);
    });
  }

  it("still lets through why a question is asked", () => {
    assert.equal(guardAcknowledgment("It helps us match the right vehicle to your needs.", "received", "en").blocked, false);
    assert.equal(guardAcknowledgment("Nos ayuda a elegir el vehículo adecuado.", "received", "es").blocked, false);
  });
});
