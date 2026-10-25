import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import WebSocket from "ws";
import type { Language } from "../agent/script";
import { Speaker, SpeakerSocket, spokenForm } from "./cartesia";
import type { Delivery } from "./delivery";

describe("spoken form", () => {
  it("spells out ID so Sonic doesn't say Idaho", () => {
    assert.equal(spokenForm("your medications, glasses, ID and phone charger"), "your medications, glasses, I-D and phone charger");
    assert.equal(spokenForm("Bring your I.D. with you."), "Bring your I-D with you.");
    assert.equal(spokenForm("Bring your ID."), "Bring your I-D.");
  });

  it("leaves words that only contain the letters alone", () => {
    assert.equal(spokenForm("IDK, the idea was Idaho Street"), "IDK, the idea was Idaho Street");
  });
});

// A stand-in for Cartesia's TTS socket that keeps what it was sent.
function fakeSocket() {
  const sent: string[] = [];
  const socket = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN,
    send: (data: string) => void sent.push(data),
    close: () => {},
  });
  return { socket, sent };
}

async function requestFor(language: Language, delivery?: Delivery) {
  process.env.CARTESIA_VOICE_EN ??= "voice-en";
  process.env.CARTESIA_VOICE_ES ??= "voice-es";
  const { socket, sent } = fakeSocket();
  const speaker = new Speaker(socket as unknown as SpeakerSocket);
  socket.emit("open");
  await speaker.speak("Leave now.", language, () => {}, delivery);
  return JSON.parse(sent[0]) as Record<string, unknown>;
}

describe("Speaker", () => {
  it("sends the delivery as generation_config on the request", async () => {
    const request = await requestFor("en", { urgency: "emergency", slower: false });
    assert.deepEqual(request.generation_config, { speed: 1.1, volume: 1.4, emotion: "determined" });
    assert.equal(request.transcript, "Leave now.");
  });

  it("sends routine-calm when no delivery is given, and no emotion outside English", async () => {
    assert.deepEqual((await requestFor("en")).generation_config, { speed: 1, volume: 1, emotion: "calm" });
    assert.deepEqual((await requestFor("es", { urgency: "imminent", slower: true })).generation_config, { speed: 0.85, volume: 1.25 });
  });
});
