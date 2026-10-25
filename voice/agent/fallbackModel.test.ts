import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { askBitdeer, FetchLike, withFallback } from "./fallbackModel";
import { guardAcknowledgment } from "./honesty";
import { parseReadyHeard } from "./readyInterpreter";

const REQUEST = { system: "Read the answer.", user: "They said yes.", schema: { type: "object" }, maxTokens: 128 };
const CLAUDE_JSON = '{"answer":"no"}';

const bitdeerReply = (content: string): FetchLike => async () =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const outage = () => new Anthropic.InternalServerError(529, { type: "error" }, "Overloaded", new Headers());
const forever = () => new Promise<string>(() => {});

let seenBodies: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
const recording = (content: string): FetchLike => async (url, init) => {
  seenBodies.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
  return bitdeerReply(content)(url, init);
};

describe("Bitdeer fallback", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    seenBodies = [];
    process.env.BITDEER_API_KEY = "test-key";
    delete process.env.FALLBACK_AFTER_MS;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("answers from Bitdeer when Claude is overloaded, in a shape parse accepts", async () => {
    const text = await withFallback(() => Promise.reject(outage()), REQUEST, recording('{"answer":"yes","acknowledgment":"Okay."}'));
    assert.equal(parseReadyHeard(text).answer, "yes");
    assert.equal(seenBodies[0].url, "https://api-inference.bitdeer.ai/v1/chat/completions");
    assert.equal(seenBodies[0].auth, "Bearer test-key");
    assert.deepEqual(seenBodies[0].body.response_format, { type: "json_object" });
    assert.match(JSON.stringify(seenBodies[0].body.messages), /JSON Schema/);
  });

  it("falls back on connection errors and timeouts", async () => {
    for (const error of [new Anthropic.APIConnectionError({}), new Anthropic.APIConnectionTimeoutError()]) {
      assert.equal(await withFallback(() => Promise.reject(error), REQUEST, bitdeerReply(CLAUDE_JSON)), CLAUDE_JSON);
    }
  });

  it("strips code fences and reasoning around the JSON", async () => {
    const text = await askBitdeer(REQUEST, bitdeerReply('<think>hmm</think>\n```json\n{"answer":"no"}\n```'));
    assert.equal(text, CLAUDE_JSON);
  });

  it("lets the error through when no key is set", async () => {
    delete process.env.BITDEER_API_KEY;
    let called = false;
    const fetchImpl: FetchLike = async () => ((called = true), new Response("{}"));
    await assert.rejects(withFallback(() => Promise.reject(outage()), REQUEST, fetchImpl), Anthropic.InternalServerError);
    assert.equal(called, false);
  });

  it("does not fall back on a refusal or a bad request", async () => {
    await assert.rejects(withFallback(() => Promise.reject(new Error("no text")), REQUEST, bitdeerReply(CLAUDE_JSON)), /no text/);
    const badRequest = new Anthropic.BadRequestError(400, { type: "error" }, "bad", new Headers());
    await assert.rejects(withFallback(() => Promise.reject(badRequest), REQUEST, bitdeerReply(CLAUDE_JSON)), Anthropic.BadRequestError);
  });

  it("uses Claude's answer when it arrives inside the latency budget", async () => {
    assert.equal(await withFallback(async () => CLAUDE_JSON, REQUEST, bitdeerReply('{"answer":"yes"}')), CLAUDE_JSON);
  });

  it("uses Bitdeer when Claude passes the latency budget", async () => {
    process.env.FALLBACK_AFTER_MS = "20";
    assert.equal(await withFallback(forever, REQUEST, bitdeerReply('{"answer":"yes"}')), '{"answer":"yes"}');
  });

  it("still takes Claude's late answer when Bitdeer fails too", async () => {
    process.env.FALLBACK_AFTER_MS = "10";
    const slowClaude = () => new Promise<string>((resolve) => setTimeout(() => resolve(CLAUDE_JSON), 60));
    const failing: FetchLike = async () => new Response("{}", { status: 503 });
    assert.equal(await withFallback(slowClaude, REQUEST, failing), CLAUDE_JSON);
  });

  it("fails as it does today when the Bitdeer JSON is malformed", async () => {
    const original = outage();
    await assert.rejects(withFallback(() => Promise.reject(original), REQUEST, bitdeerReply("sorry, no json here")), (error) => error === original);
    await assert.rejects(withFallback(() => Promise.reject(original), REQUEST, bitdeerReply("{broken")), (error) => error === original);
  });

  it("fails as it does today when Bitdeer answers an error status", async () => {
    const original = outage();
    const failing: FetchLike = async () => new Response("{}", { status: 401 });
    await assert.rejects(withFallback(() => Promise.reject(original), REQUEST, failing), (error) => error === original);
  });

  it("still blocks a Bitdeer acknowledgment that implies help is coming", async () => {
    const text = await withFallback(
      () => Promise.reject(outage()),
      REQUEST,
      bitdeerReply('{"answer":"yes","acknowledgment":"Help is on the way, a driver will be there soon."}'),
    );
    const heard = parseReadyHeard(text);
    assert.equal(guardAcknowledgment(heard.acknowledgment, "received", "en").blocked, true);
  });
});
