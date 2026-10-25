import { MossClient } from "@inferedge/moss";
import { env } from "./env";

// One Moss client for the whole server, loading one index at a time. Every load downloads the
// embedding model into the same cache file, so two loads at once corrupt it ("Protobuf parsing
// failed"). Each loaded index also holds its own copy of the model, about 125 to 250 MB, so all
// three together need about 750 MB: more than the 512 MB machine that OOM-killed on Oct 24.

const CACHE_PATH = process.env.MOSS_CACHE_PATH || ".cache/moss";
// A failed load is tried again after this long, rather than staying off until a restart.
export const MOSS_RETRY_MS = 60_000;

let client: MossClient | null = null;
let queue: Promise<unknown> = Promise.resolve();

export const mossConfigured = () => env.moss.projectId !== "" && env.moss.projectKey !== "";

export function sharedMossClient() {
  if (!mossConfigured()) return null;
  client ??= new MossClient(env.moss.projectId, env.moss.projectKey);
  return client;
}

export function loadMossIndex(name: string): Promise<void> {
  const moss = sharedMossClient();
  if (!moss) return Promise.reject(new Error("MOSS_PROJECT_ID or MOSS_PROJECT_KEY is not set"));
  const load = queue.then(() => moss.loadIndex(name, { cachePath: CACHE_PATH }));
  queue = load.catch(() => undefined);
  return load.then(() => undefined);
}
