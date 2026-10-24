const RETRY_DELAYS_MS = [1_000, 3_000];
const USER_AGENT = "california-evacuation-status-actor/0.1 (Apify; public data reader)";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

const isRetryable = (error: unknown) => !(error instanceof HttpStatusError) || error.status >= 500 || error.status === 429;

async function fetchOnce(url: string, timeoutSecs: number, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(timeoutSecs * 1000),
  });
  if (!response.ok) throw new HttpStatusError(response.status, url);
  return response;
}

export async function fetchWithRetry(url: string, timeoutSecs: number, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchOnce(url, timeoutSecs, init);
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isRetryable(error)) throw error;
      await sleep(delay);
    }
  }
}

export async function fetchJson<T>(url: string, timeoutSecs: number): Promise<T> {
  const response = await fetchWithRetry(url, timeoutSecs);
  return (await response.json()) as T;
}
