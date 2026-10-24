import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CallSpeech, SpeechEngine, TwilioSink } from "./speech";

// CallSpeech against a fake text-to-speech engine whose requests and sentences finish on cue.

type Request = { text: string; onAudio: (audio: string) => void; send: () => void; finish: () => void };

function fakeEngine() {
  const requests: Request[] = [];
  const cancelled: string[] = [];
  let counter = 0;
  const engine: SpeechEngine = {
    speak: (text, _language, onAudio) =>
      new Promise((resolveRequest) => {
        const contextId = `c${(counter += 1)}`;
        let finish = () => {};
        const done = new Promise<void>((resolve) => (finish = resolve));
        requests.push({ text, onAudio, send: () => resolveRequest({ contextId, done }), finish });
      }),
    cancel: (contextId) => void cancelled.push(contextId),
    close: () => {},
  };
  return { engine, requests, cancelled };
}

function fakeTwilio() {
  const sent: { event: string }[] = [];
  const sink: TwilioSink = { OPEN: 1, readyState: 1, send: (data: string) => void sent.push(JSON.parse(data)) } as unknown as TwilioSink;
  return { sink, sent };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("call speech", () => {
  it("counts a lone sentence as playing until Twilio says it has played", async () => {
    const { engine, requests } = fakeEngine();
    const { sink } = fakeTwilio();
    const speech = new CallSpeech(sink, "MZ", engine);
    let silent = false;
    speech.say(["Goodbye."], "en");
    void speech.whenSilent().then(() => (silent = true));
    await settle();
    assert.equal(speech.speaking, true);
    assert.equal(silent, false);
    requests[0].send();
    await settle();
    requests[0].finish();
    await settle();
    assert.equal(silent, false, "audio is generated but not yet heard");
    speech.markPlayed();
    await settle();
    assert.equal(silent, true);
  });

  it("drops a sentence whose request was still on its way at a barge-in", async () => {
    const { engine, requests, cancelled } = fakeEngine();
    const { sink, sent } = fakeTwilio();
    const speech = new CallSpeech(sink, "MZ", engine);
    speech.say(["Is that right?"], "en");
    await settle();
    speech.bargeIn();
    requests[0].send();
    await settle();
    requests[0].onAudio("audio");
    assert.deepEqual(cancelled, ["c1"]);
    assert.ok(!sent.some((message) => message.event === "media"));
    assert.equal(speech.speaking, false);
  });
});
