import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callUrgency, generationConfig, IMMINENT_WITHIN_MS, ROUTINE, turnDelivery, TurnSignals } from "./delivery";

const QUIET: TurnSignals = { emergency: false, reassigning: false, threatEarlier: false, slower: false, hardOfHearing: false };
const NOW = 1_000_000_000;

describe("delivery", () => {
  it("maps each urgency to its Sonic generation_config", () => {
    assert.deepEqual(generationConfig(ROUTINE, "en"), { speed: 1.0, volume: 1.0, emotion: "calm" });
    assert.deepEqual(generationConfig({ urgency: "warning", slower: false }, "en"), { speed: 1.05, volume: 1.05, emotion: "calm" });
    assert.deepEqual(generationConfig({ urgency: "imminent", slower: false }, "en"), { speed: 1.15, volume: 1.25, emotion: "determined" });
    assert.deepEqual(generationConfig({ urgency: "emergency", slower: false }, "en"), { speed: 1.25, volume: 1.4, emotion: "determined" });
  });

  it("slows down for a resident who asked again, keeping the urgency's volume", () => {
    assert.deepEqual(generationConfig({ urgency: "emergency", slower: true }, "en"), { speed: 0.85, volume: 1.4, emotion: "determined" });
  });

  it("leaves emotion out outside English", () => {
    for (const language of ["es", "zh", "ko", "vi", "tl", "ru", "ja"] as const) {
      assert.deepEqual(generationConfig({ urgency: "imminent", slower: false }, language), { speed: 1.15, volume: 1.25 });
    }
  });

  it("keeps every call but the rescue call routine", () => {
    assert.equal(callUrgency({ rescue: false, warningActive: true, fireArrivalAt: NOW, now: NOW }), "routine");
  });

  it("sets the rescue call's floor by the warning and how near the fire is", () => {
    assert.equal(callUrgency({ rescue: true, warningActive: false, fireArrivalAt: NOW, now: NOW }), "routine");
    assert.equal(callUrgency({ rescue: true, warningActive: true, fireArrivalAt: NOW + 3 * IMMINENT_WITHIN_MS, now: NOW }), "warning");
    assert.equal(callUrgency({ rescue: true, warningActive: true, fireArrivalAt: NOW + IMMINENT_WITHIN_MS - 1, now: NOW }), "imminent");
    assert.equal(callUrgency({ rescue: true, warningActive: true, fireArrivalAt: NOW - 1, now: NOW }), "emergency");
    assert.equal(callUrgency({ rescue: true, warningActive: true, fireArrivalAt: NOW, now: NOW }), "emergency");
  });

  it("raises a turn to emergency for a threat this turn or the reassigning line", () => {
    assert.equal(turnDelivery("routine", { ...QUIET, emergency: true }).urgency, "emergency");
    assert.equal(turnDelivery("warning", { ...QUIET, reassigning: true }).urgency, "emergency");
  });

  it("keeps later turns at least imminent after a reported threat", () => {
    assert.equal(turnDelivery("warning", { ...QUIET, threatEarlier: true }).urgency, "imminent");
    assert.equal(turnDelivery("routine", QUIET).urgency, "routine");
  });

  it("marks a turn slower after a repeat request or for a hard-of-hearing resident", () => {
    assert.equal(turnDelivery("routine", { ...QUIET, slower: true }).slower, true);
    assert.equal(turnDelivery("routine", { ...QUIET, hardOfHearing: true }).slower, true);
    assert.equal(turnDelivery("routine", QUIET).slower, false);
  });
});
