import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quickReading } from "./quickAnswer";

// Plain answers as the simulated residents phrase them (modeling/rollcall_d/resident.py), a
// corpus the parser was not written from, read to the same fields Claude would give.
const PLAIN = [
  ["en", "can_leave", "No, I can't get out on my own.", { canLeave: "no" }],
  ["en", "can_leave", "Yes, I can get out.", { canLeave: "yes" }],
  ["en", "can_leave", "I don't know. I'm not sure how I'd get out.", { canLeave: "unsure" }],
  ["en", "has_car", "No, I don't have a car.", { hasCar: false }],
  ["en", "has_car", "Yes, there's a car here I can use.", { hasCar: true }],
  ["en", "household", "It's just me.", { peopleCount: 1 }],
  ["en", "household", "There are 3 of us. And my dog.", { peopleCount: 3, pets: true }],
  ["en", "household", "Four of us. No pets.", { peopleCount: 4, pets: false }],
  ["en", "household", "Me and my husband.", { peopleCount: 2 }],
  ["en", "needs", "My son uses a wheelchair. No oxygen.", { mobility: "manual_wheelchair", medical: [] }],
  ["en", "needs", "I use a power wheelchair. And I'm on oxygen.", { mobility: "power_wheelchair", medical: ["oxygen"] }],
  ["en", "needs", "I can't get out of bed.", { mobility: "bedbound" }],
  ["en", "needs", "No, we can all walk.", { mobility: "walks" }],
  ["en", "assistance", "It takes two people to lift.", { assistanceRequired: "two_person_lift" }],
  ["en", "assistance", "One person to help.", { assistanceRequired: "one_person_assist" }],
  ["en", "assistance", "No help needed, we can manage.", { assistanceRequired: "none" }],
  ["es", "can_leave", "No, no puedo salir sola.", { canLeave: "no" }],
  ["es", "has_car", "No, no tengo carro.", { hasCar: false }],
  ["es", "household", "Somos tres. Sin mascotas.", { peopleCount: 3, pets: false }],
  ["es", "household", "Solo yo.", { peopleCount: 1 }],
  ["es", "needs", "Mi hijo usa silla de ruedas eléctrica.", { mobility: "power_wheelchair" }],
  ["es", "needs", "Uso andadera. Y uso oxígeno.", { mobility: "walker", medical: ["oxygen"] }],
  ["es", "assistance", "Se necesitan dos personas para levantarlo.", { assistanceRequired: "two_person_lift" }],
] as const;

// Anything beyond a plain answer must reach Claude.
const NOT_PLAIN = [
  ["en", "can_leave", "No. I'm in a wheelchair, I lost my leg last year, and my son can't get out of bed."],
  ["en", "household", "There's three of us, but my other son is in the hospital."],
  ["en", "household", "Two of us. Is someone coming?"],
  ["en", "needs", "My husband uses a wheelchair, but he isn't here."],
  ["en", "can_leave", "I can't get out, there's flames blowing into the house"],
  ["en", "can_leave", "No! I can't get out!"],
  ["es", "needs", "Mi esposo usa silla de ruedas, pero no está aquí."],
] as const;

describe("plain answers read without Claude", () => {
  for (const [language, step, said, updates] of PLAIN) {
    it(`${step}: "${said}"`, () => assert.deepEqual(quickReading(said, step, language)?.updates, updates));
  }
  for (const [language, step, said] of NOT_PLAIN) {
    it(`leaves "${said}" to Claude`, () => assert.equal(quickReading(said, step, language), null));
  }
});

describe("which kind of wheelchair, read by code", () => {
  it("knows the kind was said for a power or manual chair, and not for a bare wheelchair", () => {
    assert.equal(quickReading("I use a power wheelchair.", "needs", "en")?.saysChairKind, true);
    assert.equal(quickReading("My son uses a manual wheelchair.", "needs", "en")?.saysChairKind, true);
    assert.equal(quickReading("My son uses a wheelchair.", "needs", "en")?.saysChairKind, false);
  });
});
