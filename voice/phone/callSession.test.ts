import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentTurn } from "../agent/conversation";
import type { CallLine, Hearing } from "./line";
import { CallSession } from "./callSession";
import { LINES } from "../agent/script";

// The turn-taking half of a call on its own: a fake line feeds transcripts, and the conversation
// records which utterances Claude was asked to read. Nothing reaches Convex, Twilio or Cartesia.

const TURN: AgentTurn = { acknowledgment: "", sentences: ["Okay."], stage: "can_leave", done: false, guardBlocked: false, ignored: false };
const AFTER_TURN_GAP_MS = 1300;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function session(mode: "survey" | "inbound" = "survey") {
  let hearing: Hearing | null = null;
  const said: string[] = [];
  const line = {
    callSid: `CA-test-${Math.random()}`,
    params: { mode },
    voice: {
      speaking: false,
      say: (sentences: string[]) => said.push(sentences.join(" ")),
      cutIn: () => {},
      bargeIn: () => {},
      whenSilent: async () => {},
    },
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
  return { say, reads, answered, said, call };
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

const MAILBOX =
  "six five zero seven zero nine nine nine one one can't take your call now. At the tone, please record your message. When you've finished recording, simply hang up.";

describe("a mailbox that answers", () => {
  it("leaves the warning and does not interview the recording", () => {
    const { say, reads, answered, said } = session();
    say(MAILBOX);
    assert.deepEqual(reads, []);
    assert.deepEqual(answered, []);
    assert.equal(said.length, 1);
    assert.equal(said[0], LINES.en.voicemail);
  });

  it("still hears a person who says they couldn't hear", () => {
    const { say, reads, said } = session();
    say("I couldn't hear you, say that again.");
    assert.deepEqual(reads, ["I couldn't hear you, say that again."]);
    assert.deepEqual(said, []);
  });

  it("lets an inbound caller say the same words", () => {
    const { say, reads, said } = session("inbound");
    say(MAILBOX);
    assert.deepEqual(reads, [MAILBOX]);
    assert.deepEqual(said, []);
  });
});
