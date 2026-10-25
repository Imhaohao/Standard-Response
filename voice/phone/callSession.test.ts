import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentTurn } from "../agent/conversation";
import type { CallLine, Hearing } from "./line";
import { CallSession } from "./callSession";

// The turn-taking half of a call on its own: a fake line feeds transcripts, and the conversation
// records which utterances Claude was asked to read. Nothing reaches Convex, Twilio or Cartesia.

const TURN: AgentTurn = { acknowledgment: "", sentences: ["Okay."], stage: "can_leave", done: false, guardBlocked: false, ignored: false };
const AFTER_TURN_GAP_MS = 1300;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function session() {
  let hearing: Hearing | null = null;
  const line = {
    callSid: `CA-test-${Math.random()}`,
    params: { mode: "survey" },
    voice: { speaking: false, say: () => {}, cutIn: () => {}, bargeIn: () => {}, whenSilent: async () => {} },
    fillsPauses: false,
    listen: (_language: string, heard: Hearing) => (hearing = heard),
    hangUp: async () => {},
    connectTo: async () => {},
    close: () => {},
  } as unknown as CallLine;
  const call = new CallSession(line) as unknown as Record<string, unknown>;
  const reads: string[] = [];
  const answered: string[] = [];
  call.conversation = {
    language: "en",
    done: false,
    holding: false,
    read: async (utterance: string) => (reads.push(utterance), () => TURN),
  };
  call.language = "en";
  call.restartQuietTimer = () => {};
  call.answer = (utterance: string) => answered.push(utterance);
  (call.listen as () => void).call(call);
  const say = (text: string, isFinal = true) => hearing!.onSpeech(text, isFinal, 800);
  return { say, reads, answered };
}

describe("reading ahead of the turn gap", () => {
  it("starts reading as soon as the words are final, and answers from that reading", async () => {
    const { say, reads, answered } = session();
    say("No, I can't leave on my own.");
    assert.deepEqual(reads, ["No, I can't leave on my own."]);
    assert.deepEqual(answered, []);
    await wait(AFTER_TURN_GAP_MS);
    assert.deepEqual(answered, ["No, I can't leave on my own."]);
    assert.equal(reads.length, 1);
  });

  it("drops a reading the resident talks past and reads the whole turn", async () => {
    const { say, reads, answered } = session();
    say("No.");
    say("My husband uses a wheelchair.");
    await wait(AFTER_TURN_GAP_MS);
    assert.deepEqual(reads, ["No.", "No. My husband uses a wheelchair."]);
    assert.deepEqual(answered, ["No. My husband uses a wheelchair."]);
  });

  it("doesn't read words that aren't final yet", () => {
    const { say, reads } = session();
    say("No, I", false);
    assert.deepEqual(reads, []);
  });
});
