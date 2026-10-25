import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TurnAudio } from "./turnAudio";

// 20 ms frames of μ-law: 0xff is silence, 0x90 is loud enough to be voice.
const SILENT_FRAME = Buffer.alloc(160, 0xff);
const LOUD_FRAME = Buffer.alloc(160, 0x90);
const frames = (frame: Buffer, count: number) => Array.from({ length: count }, () => frame);

describe("turn audio", () => {
  it("has nothing to rehear until someone speaks", () => {
    const audio = new TurnAudio();
    for (const frame of frames(SILENT_FRAME, 100)) audio.hear(frame);
    assert.equal(audio.clip(), null);
  });

  it("keeps only a short lead-in of the quiet before the resident speaks", () => {
    const audio = new TurnAudio();
    for (const frame of [...frames(SILENT_FRAME, 250), ...frames(LOUD_FRAME, 50)]) audio.hear(frame);
    // 300 ms of lead-in is 15 frames, then the 50 voiced ones.
    assert.equal(audio.clip()?.length, 65 * 160);
  });

  it("keeps the latest 30 seconds of a long turn", () => {
    const audio = new TurnAudio();
    for (const frame of frames(LOUD_FRAME, 2000)) audio.hear(frame);
    assert.equal(audio.clip()?.length, 1500 * 160);
  });

  it("starts over when the turn is taken", () => {
    const audio = new TurnAudio();
    for (const frame of frames(LOUD_FRAME, 10)) audio.hear(frame);
    audio.reset();
    assert.equal(audio.clip(), null);
  });
});
