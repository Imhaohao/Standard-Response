import { AsyncLocalStorage } from "node:async_hooks";

const RETRY_DELAYS_MS = [1_000, 3_000];
const USER_AGENT = "california-evacuation-status-actor/0.1 (Apify; public data reader)";
const BRIGHT_DATA_ENDPOINT = "https://api.brightdata.com/request";
const UNLABELLED = "other";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type FetchPath = "direct" | "brightData";

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    url: string,
    readonly via: FetchPath = "direct",
  ) {
    super(`HTTP ${status} from ${url}${via === "brightData" ? " (via Bright Data)" : ""}`);
  }
}

export class BlockedError extends Error {
  constructor(url: string, reason: string) {
    super(`Blocked by bot protection at ${url}: ${reason}`);
  }
}

export interface BrightDataConfig {
  apiKey: string;
  zone: string;
}

export interface FetchOptions {
  // Only requests marked unblock go through Bright Data, and only when it is configured.
  unblock?: boolean;
}

export interface FetchStats {
  fetchedVia: Record<FetchPath, number>;
  blocked: Record<string, number>;
}

let brightData: BrightDataConfig | undefined;
let stats: FetchStats = emptyStats();
const sourceLabel = new AsyncLocalStorage<string>();

function emptyStats(): FetchStats {
  return { fetchedVia: { direct: 0, brightData: 0 }, blocked: {} };
}

export function configureBrightData(config: BrightDataConfig | undefined) {
  brightData = config;
}

export const brightDataConfigured = () => brightData !== undefined;

export function resetFetchStats() {
  stats = emptyStats();
}

export const fetchStats = (): FetchStats => ({ fetchedVia: { ...stats.fetchedVia }, blocked: { ...stats.blocked } });

// Requests made inside this callback are counted under the given source name.
export const withSourceLabel = <T>(label: string, work: () => Promise<T>) => sourceLabel.run(label, work);

export function resolveBrightData(input: { brightDataApiKey?: string; brightDataZone?: string }, env: NodeJS.ProcessEnv = process.env) {
  const apiKey = (input.brightDataApiKey || env.BRIGHTDATA_API_KEY || "").trim();
  const zone = (input.brightDataZone || env.BRIGHTDATA_ZONE || "").trim();
  return apiKey && zone ? { apiKey, zone } : undefined;
}

const isRetryable = (error: unknown) => !(error instanceof HttpStatusError) || error.status >= 500 || error.status === 429;

const looksLikeChallengePage = (text: string) =>
  /^\s*<(!doctype|html)/i.test(text) && /access denied|captcha|challenge|just a moment|unusual traffic/i.test(text);

function countBlocked() {
  const label = sourceLabel.getStore() ?? UNLABELLED;
  stats.blocked[label] = (stats.blocked[label] ?? 0) + 1;
}

const isBlockStatus = (error: unknown) =>
  error instanceof HttpStatusError && error.via === "direct" && (error.status === 403 || error.status === 429);

function requestFor(url: string, init: RequestInit, via: FetchPath): [string, RequestInit] {
  if (via === "direct" || !brightData) {
    return [url, { ...init, headers: { "user-agent": USER_AGENT, accept: "application/json", ...init.headers } }];
  }
  const payload = { zone: brightData.zone, url, format: "raw" };
  const headers = { "content-type": "application/json", authorization: `Bearer ${brightData.apiKey}` };
  return [BRIGHT_DATA_ENDPOINT, { method: "POST", headers, body: JSON.stringify(payload) }];
}

async function fetchOnce(url: string, timeoutSecs: number, init: RequestInit, via: FetchPath) {
  const [target, request] = requestFor(url, init, via);
  const response = await fetch(target, { ...request, signal: AbortSignal.timeout(timeoutSecs * 1000) });
  if (!response.ok) throw new HttpStatusError(response.status, url, via);
  return response;
}

export async function fetchWithRetry(url: string, timeoutSecs: number, init: RequestInit = {}, options: FetchOptions = {}) {
  const via: FetchPath = options.unblock && brightData ? "brightData" : "direct";
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchOnce(url, timeoutSecs, init, via);
      stats.fetchedVia[via] += 1;
      return response;
    } catch (error) {
      if (isBlockStatus(error)) countBlocked();
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isRetryable(error)) throw error;
      await sleep(delay);
    }
  }
}

export function parseJsonBody<T>(text: string, url: string): T {
  if (looksLikeChallengePage(text)) {
    countBlocked();
    throw new BlockedError(url, "got a challenge page instead of JSON");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Response from ${url} was not JSON`);
  }
}

export async function fetchJson<T>(url: string, timeoutSecs: number, options: FetchOptions = {}): Promise<T> {
  const response = await fetchWithRetry(url, timeoutSecs, {}, options);
  return parseJsonBody<T>(await response.text(), url);
}
