import { AsyncLocalStorage } from "node:async_hooks";

const RETRY_DELAYS_MS = [1_000, 3_000];
const USER_AGENT = "california-evacuation-status-actor/0.1 (Apify; public data reader)";
const UNLABELLED = "other";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

export class BlockedError extends Error {
  constructor(url: string, reason: string) {
    super(`Blocked by bot protection at ${url}: ${reason}`);
  }
}

export interface FetchStats {
  blocked: Record<string, number>;
}

let stats: FetchStats = emptyStats();
const sourceLabel = new AsyncLocalStorage<string>();

function emptyStats(): FetchStats {
  return { blocked: {} };
}

export function resetFetchStats() {
  stats = emptyStats();
}

export const fetchStats = (): FetchStats => ({ blocked: { ...stats.blocked } });

// Requests made inside this callback are counted under the given source name.
export const withSourceLabel = <T>(label: string, work: () => Promise<T>) => sourceLabel.run(label, work);

const isRetryable = (error: unknown) => !(error instanceof HttpStatusError) || error.status >= 500 || error.status === 429;

const looksLikeChallengePage = (text: string) =>
  /^\s*<(!doctype|html)/i.test(text) && /access denied|captcha|challenge|just a moment|unusual traffic/i.test(text);

function countBlocked() {
  const label = sourceLabel.getStore() ?? UNLABELLED;
  stats.blocked[label] = (stats.blocked[label] ?? 0) + 1;
}

const isBlockStatus = (error: unknown) =>
  error instanceof HttpStatusError && (error.status === 403 || error.status === 429);

async function fetchOnce(url: string, timeoutSecs: number, init: RequestInit) {
  const headers = { "user-agent": USER_AGENT, accept: "application/json", ...init.headers };
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutSecs * 1000) });
  if (!response.ok) throw new HttpStatusError(response.status, url);
  return response;
}

export async function fetchWithRetry(url: string, timeoutSecs: number, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchOnce(url, timeoutSecs, init);
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

export async function fetchJson<T>(url: string, timeoutSecs: number): Promise<T> {
  const response = await fetchWithRetry(url, timeoutSecs);
  return parseJsonBody<T>(await response.text(), url);
}
