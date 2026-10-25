import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import WebSocket from "ws";
import type { Language } from "../agent/script";
import { protocolFor, Speaker, SpeakerSocket, spokenForm } from "./cartesia";
import type { Delivery } from "./delivery";

describe("listening", () => {
  it("caps how long Ink-2 waits on a turn it isn't sure is over, and sets no language", () => {
    const url = new URL(protocolFor("en").url);
    assert.equal(url.pathname, "/stt/turns/websocket");
    assert.equal(url.searchParams.get("end_timeout_ms"), "2000");
    assert.equal(url.searchParams.get("language"), null);
  });
});

describe("spoken form", () => {
  it("spells out ID so Sonic doesn't say Idaho", () => {
    assert.equal(spokenForm("your medications, glasses, ID and phone charger"), "your medications, glasses, I-D and phone charger");
    assert.equal(spokenForm("Bring your I.D. with you."), "Bring your I-D with you.");
    assert.equal(spokenForm("Bring your ID."), "Bring your I-D.");
  });

  it("says 911 digit by digit, not nine hundred eleven", () => {
    assert.equal(spokenForm("If fire reaches your home, call 911."), "If fire reaches your home, call 9 1 1.");
    assert.equal(spokenForm("This is 911, calling about the evacuation."), "This is 9 1 1, calling about the evacuation.");
  });

  it("leaves a 911 house number as a number", () => {
    assert.equal(spokenForm("Are you at 911 Elm Street?"), "Are you at 911 Elm Street?");
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
    assert.deepEqual(request.generation_config, { speed: 1.25, volume: 1.4, emotion: "determined" });
    assert.equal(request.transcript, "Leave now.");
  });

  it("sends routine-calm when no delivery is given, and no emotion outside English", async () => {
    assert.deepEqual((await requestFor("en")).generation_config, { speed: 1, volume: 1, emotion: "calm" });
    assert.deepEqual((await requestFor("es", { urgency: "imminent", slower: true })).generation_config, { speed: 0.85, volume: 1.25 });
  });
});
