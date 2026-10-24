import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interrupts, isBackchannel } from "./interruption";

describe("interruption", () => {
  it("keeps talking through listening noises, however much voice is behind them", () => {
    assert.ok(!interrupts("Mm-hmm.", 900, "en"));
    assert.ok(!interrupts("Yeah, okay.", 900, "en"));
    assert.ok(!interrupts("Uh-huh, right", 900, "en"));
    assert.ok(!interrupts("Sí, claro.", 900, "es"));
    assert.ok(!interrupts("嗯嗯", 900, "zh"));
    assert.ok(!interrupts("はい", 900, "ja"));
  });

  it("keeps talking through a stray word from a cough or a door", () => {
    assert.ok(!interrupts("Hmm.", 300, "en"));
    assert.ok(!interrupts("The", 400, "en"));
  });

  it("stops for a resident who is really talking", () => {
    assert.ok(interrupts("Actually there are three of us", 800, "en"));
    assert.ok(interrupts("Yeah but my wife uses a wheelchair", 900, "en"));
    assert.ok(interrupts("Somos tres personas", 700, "es"));
    assert.ok(interrupts("我家有三个人", 700, "zh"));
  });

  it("doesn't stop for words with too little voice behind them", () => {
    assert.ok(!interrupts("Actually there are three of us", 100, "en"));
  });

  it("stops at once for a word asking it to stop", () => {
    assert.ok(interrupts("Wait.", 350, "en"));
    assert.ok(interrupts("No, no.", 350, "en"));
    assert.ok(interrupts("Hold on", 350, "en"));
    assert.ok(interrupts("Espere", 350, "es"));
    assert.ok(interrupts("等一下", 350, "zh"));
    assert.ok(!interrupts("Wait.", 100, "en"));
    assert.ok(!interrupts("Nothing", 350, "en"));
  });

  it("tells listening noises from answers", () => {
    assert.ok(isBackchannel("Mmm, yeah.", "en"));
    assert.ok(isBackchannel("Okay", "en"));
    assert.ok(!isBackchannel("Two people", "en"));
    assert.ok(!isBackchannel("No", "en"));
    assert.ok(!isBackchannel("", "en"));
  });
});
