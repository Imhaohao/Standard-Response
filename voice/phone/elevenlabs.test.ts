import assert from "node:assert/strict";
import { test } from "node:test";
import { recordFrom, systemPrompt } from "./elevenlabs";

test("save_answers maps oxygen and dialysis onto the medical list and drops empty fields", () => {
  assert.deepEqual(recordFrom({ canLeave: "no", oxygen: true, dialysis: false, pets: undefined }), { canLeave: "no", medical: ["oxygen"] });
  assert.deepEqual(recordFrom({ peopleCount: 2 }), { peopleCount: 2 });
});

test("the prompt carries what is on file and tells the agent to let the caller finish", () => {
  const prompt = systemPrompt({ language: "es", firstMessage: "", knownAddress: "12 Oak St", onFile: { mobility: "walker" } });
  assert.match(prompt, /Let the caller finish/);
  assert.match(prompt, /12 Oak St/);
  assert.match(prompt, /walker/);
  assert.match(prompt, /"es"/);
});
