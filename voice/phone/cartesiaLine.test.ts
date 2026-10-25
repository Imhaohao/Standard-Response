import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CartesiaLine, CartesiaTiming, CartesiaVoice, SocketSink } from "./cartesiaLine";

// CartesiaLine against a fake socket: what it sends Cartesia and what it tells the call session.

const QUICK: CartesiaTiming = { turnSettleMs: 20, voiceSettleMs: 30 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  const socket: SocketSink = { OPEN: 1, readyState: 1, send: (data: string) => void sent.push(JSON.parse(data)) };
  return { socket, sent };
}

function lineWithHearing() {
  const { socket, sent } = fakeSocket();
  const line = new CartesiaLine(socket, "ac_1", { mode: "survey" }, (language) => `voice-${language}`, QUICK);
  const heard: string[] = [];
  let turnEnds = 0;
  line.listen("en", { onSpeech: (text) => void heard.push(text), onTurnEnd: () => void (turnEnds += 1), onError: () => {} });
  return { line, sent, heard, turnEnds: () => turnEnds };
}

describe("cartesia line", () => {
  it("logs how long Cartesia took to start voicing a message, once per message", async () => {
    const logged: string[] = [];
    const voice = new CartesiaVoice(() => {}, () => {}, (message) => void logged.push(message));
    voice.say(["Two people."], "en");
    await voice.sent();
    await pause(15);
    voice.agentState("speaking");
    voice.agentState("idle");
    voice.agentState("speaking");
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^voice started \d+ms after the message left$/);
    assert.ok(Number(/(\d+)ms/.exec(logged[0])![1]) >= 10);
  });

  it("sets the listening language and the voice when it starts listening", () => {
    const { sent } = lineWithHearing();
    assert.deepEqual(sent, [
      { type: "config", stt: { language: "en" }, language: "en" },
      { type: "config", tts: { voice_id: "voice-en", language: "en" } },
    ]);
  });

  it("holds the greeting back until the voice change has settled", async () => {
    const { line, sent } = lineWithHearing();
    line.voice.say(["Hi, this is the evacuation line."], "en");
    assert.equal(line.voice.speaking, true, "it counts as speaking from the moment it's handed over");
    await pause(10);
    assert.equal(sent.some((message) => message.type === "message"), false);
    await line.voice.sent();
    assert.deepEqual(sent.at(-2), { type: "message", content: "Hi, this is the evacuation line.", interruptible: true });
  });

  it("sends a turn as one message and closes it, switching voice only when the language changes", async () => {
    const { line, sent } = lineWithHearing();
    await pause(QUICK.voiceSettleMs);
    sent.length = 0;
    line.voice.say(["Two people.", "Is that right?"], "en");
    line.voice.say(["Hola."], "es");
    await line.voice.sent();
    assert.deepEqual(sent, [
      { type: "message", content: "Two people. Is that right?", interruptible: true },
      { type: "response_end" },
      { type: "config", tts: { voice_id: "voice-es", language: "es" } },
      { type: "message", content: "Hola.", interruptible: true },
      { type: "response_end" },
    ]);
  });

  it("answers a turn once the resident has gone quiet after a transcript, in either order", async () => {
    const { line, heard, turnEnds } = lineWithHearing();
    line.receive({ type: "user_state", value: "speaking" });
    line.receive({ type: "message", content: "It's just me." });
    line.receive({ type: "user_state", value: "idle" });
    assert.equal(turnEnds(), 0, "it waits a moment for more");
    await pause(QUICK.turnSettleMs + 10);
    assert.equal(turnEnds(), 1);
    line.receive({ type: "user_state", value: "speaking" });
    line.receive({ type: "user_state", value: "idle" });
    await pause(QUICK.turnSettleMs + 10);
    assert.equal(turnEnds(), 1, "a turn with no words in it isn't answered");
    line.receive({ type: "message", content: "No car." });
    await pause(QUICK.turnSettleMs + 10);
    assert.equal(turnEnds(), 2, "a transcript that lands after the quiet ends the turn");
    assert.deepEqual(heard, ["It's just me.", "No car."]);
  });

  it("reads scraps of room talk a moment apart as one turn", async () => {
    const { line, heard, turnEnds } = lineWithHearing();
    for (const scrap of ["Yeah,", "Oh, that's disgusting."]) {
      line.receive({ type: "user_state", value: "speaking" });
      line.receive({ type: "message", content: scrap });
      line.receive({ type: "user_state", value: "idle" });
      await pause(QUICK.turnSettleMs / 2);
    }
    await pause(QUICK.turnSettleMs + 10);
    assert.equal(turnEnds(), 1);
    assert.deepEqual(heard, ["Yeah,", "Oh, that's disgusting."]);
  });

  it("never covers Claude's reading time with a filler", () => {
    const { line } = lineWithHearing();
    assert.equal(line.fillsPauses, false);
  });

  it("counts the agent as speaking from the message until Cartesia reports it idle", async () => {
    const { line } = lineWithHearing();
    line.voice.say(["One moment."], "en");
    await line.voice.sent();
    line.receive({ type: "agent_state", value: "speaking" });
    let silent = false;
    void line.voice.whenSilent().then(() => (silent = true));
    await pause(350);
    line.receive({ type: "agent_state", value: "idle" });
    await pause(0);
    assert.equal(silent, true);
    assert.equal(line.voice.speaking, false);
  });

  it("hangs up and transfers after what it was saying has gone out", async () => {
    const { line, sent } = lineWithHearing();
    line.voice.say(["Connecting you now."], "en");
    await line.connectTo("+15550100103");
    await line.hangUp();
    assert.deepEqual(sent.slice(-4), [
      { type: "message", content: "Connecting you now.", interruptible: true },
      { type: "response_end" },
      { type: "transfer", transfer_destination: { type: "phone", value: "+15550100103" }, interruptible: false },
      { type: "end_call" },
    ]);
  });
});
