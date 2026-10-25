import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatSession, openingConfig, parametersFor } from "./cartesiaCalls";

process.env.CARTESIA_PHONE_NUMBER = "+18506417117";

// Which household conversation a Cartesia call is, when this server didn't place it.

describe("cartesia calls we didn't place", () => {
  it("talks to the resident who called our number", async () => {
    const parameters = await parametersFor({ agent_call_id: "ac_in", from: "+16265550102", to: "+18506417117" });
    assert.deepEqual(parameters, { mode: "inbound", from: "+16265550102" });
  });

  it("talks to the person a call from Cartesia's dashboard rang", async () => {
    const parameters = await parametersFor({ agent_call_id: "ac_dash", from: "+18506417117", to: "+16506567040" });
    assert.deepEqual(parameters, { mode: "inbound", from: "+16506567040" });
  });
});

describe("where a Cartesia call connects", () => {
  it("opens the transcriber and the voice in the call's language", () => {
    assert.deepEqual(openingConfig("zh"), {
      stt: { language: "zh" },
      tts: { voice_id: "0f5ac064-30c7-4cf6-8748-d275f682a0d5", language: "zh" },
    });
  });

  it("leaves a call it can't place to Cartesia's defaults", async () => {
    const session = await chatSession({ agent_call_id: "ac_unknown", metadata: { source: "dashboard" } });
    assert.deepEqual(session, { websocket_url: "/ws", cartesia_version: "2026-04-03", metadata: { source: "dashboard" } });
  });
});
