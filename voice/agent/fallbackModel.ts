import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { jsonObjectIn, jsonRule } from "./jsonReply";

// Backup for the three interpreters when Claude is down, slow or refusing this account mid-call. The same system prompt,
// user text and JSON schema go to a Bitdeer AI Model Studio model (OpenAI-compatible chat
// completions), and the reply goes through the same parse function as Claude's. Honesty is not at
// stake here: whatever model answers, the honesty guard and the fixed templates run on the result.

export type FallbackRequest = { system: string; user: string; schema: object; maxTokens: number };
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const BITDEER_TIMEOUT_MS = 6000;
const RATE_LIMITED = 429;
const SERVER_ERROR = 500;

type Settled = { ok: true; text: string } | { ok: false; error: unknown };

// The account can't use Claude at all: a bad or revoked key, no permission, or no credit left. The
// API reports an empty credit balance as a 400 like any bad request, so only its message tells it
// apart; the eval account ran dry on the night, and every live turn would have been "Say that again?".
const ACCOUNT_REFUSED = new Set([401, 402, 403]);
const NO_CREDIT = /credit balance is too low/i;

function isAccountFailure(error: InstanceType<typeof Anthropic.APIError>) {
  return (typeof error.status === "number" && ACCOUNT_REFUSED.has(error.status)) || NO_CREDIT.test(error.message);
}

function isOutage(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.some(isOutage);
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (!(error instanceof Anthropic.APIError)) return false;
  if (isAccountFailure(error)) return true;
  return typeof error.status === "number" && (error.status >= SERVER_ERROR || error.status === RATE_LIMITED);
}

function bodyFor(request: FallbackRequest) {
  return {
    model: env.bitdeer.model(),
    max_tokens: request.maxTokens,
    temperature: 0,
    response_format: { type: "json_object" },
    // Bitdeer's models think before answering by default, which costs a phone turn about a second
    // (and can spend the whole token budget); switched off, Qwen3.8-27B answers in about 0.5 s.
    chat_template_kwargs: { enable_thinking: false, thinking: false },
    messages: [
      { role: "system", content: `${request.system}\n\n${jsonRule(request.schema)}` },
      { role: "user", content: request.user },
    ],
  };
}

export async function askBitdeer(request: FallbackRequest, fetchImpl: FetchLike = fetch): Promise<string> {
  const response = await fetchImpl(`${env.bitdeer.baseUrl()}/chat/completions`, {
    method: "POST",
    // Bitdeer's firewall refuses some default client user agents with a 403.
    headers: { "content-type": "application/json", authorization: `Bearer ${env.bitdeer.apiKey()}`, "user-agent": "standard-response-voice/1.0" },
    body: JSON.stringify(bodyFor(request)),
    signal: AbortSignal.timeout(BITDEER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Bitdeer answered ${response.status}`);
  const reply = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = reply.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Bitdeer reply holds no text");
  return jsonObjectIn(content);
}

const settle = (run: Promise<string>): Promise<Settled> =>
  run.then(
    (text): Settled => ({ ok: true, text }),
    (error: unknown): Settled => ({ ok: false, error }),
  );

const afterDelay = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref());

async function backupFor(original: unknown, request: FallbackRequest, fetchImpl: FetchLike) {
  try {
    const text = await askBitdeer(request, fetchImpl);
    console.log("[fallback] bitdeer answered turn");
    return text;
  } catch {
    throw original;
  }
}

// primary is the Claude request, already reduced to the JSON text its parse function takes.
export async function withFallback(primary: () => Promise<string>, request: FallbackRequest, fetchImpl: FetchLike = fetch): Promise<string> {
  if (!env.bitdeer.apiKey()) return primary();
  const claude = settle(primary());
  const early = await Promise.race([claude, afterDelay(env.bitdeer.fallbackAfterMs())]);
  if (early?.ok) return early.text;
  if (early) return outageOrThrow(early.error, request, fetchImpl);
  return firstAnswer(claude, request, fetchImpl);
}

function outageOrThrow(error: unknown, request: FallbackRequest, fetchImpl: FetchLike) {
  if (!isOutage(error)) throw error;
  return backupFor(error, request, fetchImpl);
}

// Claude is slow, not failed: Bitdeer starts now and the first good answer wins.
async function firstAnswer(claude: Promise<Settled>, request: FallbackRequest, fetchImpl: FetchLike) {
  const slowError = new Error("Claude exceeded the latency budget");
  const backup = backupFor(slowError, request, fetchImpl);
  const claudeText = claude.then((result) => (result.ok ? result.text : Promise.reject(result.error)));
  try {
    return await Promise.any([claudeText, backup]);
  } catch (failure) {
    throw failure instanceof AggregateError ? failure.errors[0] : failure;
  }
}
