import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPhantom, mulawLevel, VoiceActivity } from "./phantomSpeech";

// μ-law 0xff is silence; 0x80 is the loudest positive sample.
const SILENT_FRAME = Buffer.alloc(160, 0xff);
const LOUD_FRAME = Buffer.alloc(160, 0x90);

describe("phantom speech", () => {
  it("measures silence as quiet and a loud frame as voice", () => {
    assert.equal(mulawLevel(SILENT_FRAME), 0);
    assert.ok(mulawLevel(LOUD_FRAME) > 5000);
  });

  it("counts only voiced frames, and resets after a transcript", () => {
    const voice = new VoiceActivity();
    for (let frame = 0; frame < 15; frame += 1) voice.hear(LOUD_FRAME);
    for (let frame = 0; frame < 50; frame += 1) voice.hear(SILENT_FRAME);
    assert.equal(voice.voicedMs, 300);
    voice.reset();
    assert.equal(voice.voicedMs, 0);
  });

  it("drops a silence phrase with no voice behind it", () => {
    assert.ok(isPhantom("Thank you.", 0));
    assert.ok(isPhantom("감사합니다.", 40));
    assert.ok(isPhantom(" Gracias. ", 0));
  });

  it("keeps a silence phrase someone actually said", () => {
    assert.ok(!isPhantom("Thank you.", 400));
    assert.ok(!isPhantom("谢谢", 300));
  });

  it("keeps ordinary answers even with little voice measured", () => {
    assert.ok(!isPhantom("Two people.", 0));
    assert.ok(!isPhantom("Yes", 0));
  });

  it("drops a looped word unless it carried that much voice", () => {
    assert.ok(isPhantom("다행히 다행히 다행히 다행히 다행히", 200));
    assert.ok(!isPhantom("No, no, no, no.", 800));
  });
});
