import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CartesiaLine, SocketSink } from "./cartesiaLine";

// CartesiaLine against a fake socket: what it sends Cartesia and what it tells the call session.

function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  const socket: SocketSink = { OPEN: 1, readyState: 1, send: (data: string) => void sent.push(JSON.parse(data)) };
  return { socket, sent };
}

function lineWithHearing() {
  const { socket, sent } = fakeSocket();
  const line = new CartesiaLine(socket, "ac_1", { mode: "survey" }, (language) => `voice-${language}`);
  const heard: string[] = [];
  let turnEnds = 0;
  line.listen("en", { onSpeech: (text) => void heard.push(text), onTurnEnd: () => void (turnEnds += 1), onError: () => {} });
  return { line, sent, heard, turnEnds: () => turnEnds };
}

describe("cartesia line", () => {
  it("sets the listening language and the voice when it starts listening", () => {
    const { sent } = lineWithHearing();
    assert.deepEqual(sent, [
      { type: "config", stt: { language: "en" }, language: "en" },
      { type: "config", tts: { voice_id: "voice-en", language: "en" } },
    ]);
  });

  it("sends a turn as one message and closes it, switching voice only when the language changes", () => {
    const { line, sent } = lineWithHearing();
    sent.length = 0;
    line.voice.say(["Two people.", "Is that right?"], "en");
    line.voice.say(["Hola."], "es");
    assert.deepEqual(sent, [
      { type: "message", content: "Two people. Is that right?", interruptible: true },
      { type: "response_end" },
      { type: "config", tts: { voice_id: "voice-es", language: "es" } },
      { type: "message", content: "Hola.", interruptible: true },
      { type: "response_end" },
    ]);
  });

  it("ends the resident's turn when they go quiet after a transcript, in either order", () => {
    const { line, heard, turnEnds } = lineWithHearing();
    line.receive({ type: "user_state", value: "speaking" });
    line.receive({ type: "message", content: "It's just me." });
    assert.equal(turnEnds(), 0);
    line.receive({ type: "user_state", value: "idle" });
    assert.equal(turnEnds(), 1);
    line.receive({ type: "user_state", value: "speaking" });
    line.receive({ type: "user_state", value: "idle" });
    assert.equal(turnEnds(), 1, "a turn with no words in it isn't answered");
    line.receive({ type: "message", content: "No car." });
    assert.equal(turnEnds(), 2, "a transcript that lands after the quiet ends the turn at once");
    assert.deepEqual(heard, ["It's just me.", "No car."]);
  });

  it("counts the agent as speaking from the message until Cartesia reports it idle", async () => {
    const { line } = lineWithHearing();
    line.voice.say(["One moment."], "en");
    assert.equal(line.voice.speaking, true);
    line.receive({ type: "agent_state", value: "speaking" });
    let silent = false;
    void line.voice.whenSilent().then(() => (silent = true));
    await new Promise((resolve) => setTimeout(resolve, 350));
    line.receive({ type: "agent_state", value: "idle" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(silent, true);
    assert.equal(line.voice.speaking, false);
  });

  it("hangs up and transfers with Cartesia's own call controls", async () => {
    const { line, sent } = lineWithHearing();
    sent.length = 0;
    await line.connectTo("+15550100103");
    await line.hangUp();
    assert.deepEqual(sent, [
      { type: "transfer", transfer_destination: { type: "phone", value: "+15550100103" }, interruptible: false },
      { type: "end_call" },
    ]);
  });
});
