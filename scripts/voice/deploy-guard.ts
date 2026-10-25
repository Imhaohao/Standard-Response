// Runs before `npm run deploy:voice`. A deploy restarts the one voice machine, which drops every call
// on it, so it stops while any call is live. FORCE_VOICE_DEPLOY=1 deploys anyway (a broken server).
// It also stops when the image's sources have uncommitted changes: the build copies this folder, and
// a deploy once shipped another session's half-done edits, which crashed the server on boot.
//   npx tsx --env-file=.env.local scripts/voice/deploy-guard.ts

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
// A call the restart dropped is never ended and stays "live"; one this old isn't a real conversation.
const STALE_CALL_MS = 30 * 60 * 1000;

function serverUrl() {
  const app = /^app\s*=\s*"([^"]+)"/m.exec(readFileSync(path.join(root, "voice/fly.toml"), "utf8"))?.[1];
  if (!app) throw new Error("voice/fly.toml names no app");
  return `https://${app}.fly.dev`;
}

// Every call the server holds, Ready and plan checks included, which never appear in calls:active.
// Null when the server can't say: it's down, or runs code from before /live existed.
async function callsOnServer(): Promise<number | null> {
  try {
    const response = await fetch(`${serverUrl()}/live`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const { calls } = (await response.json()) as { calls: number };
    return calls;
  } catch {
    return null;
  }
}

async function liveRealCalls() {
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Set CONVEX_URL or NEXT_PUBLIC_CONVEX_URL (run with --env-file=.env.local)");
  const calls = await new ConvexHttpClient(url).query(api.calls.active, {});
  const now = Date.now();
  return calls.filter((call) => !call.simulated && now - call._creationTime < STALE_CALL_MS);
}

// What the Dockerfile copies into the image.
const IMAGE_SOURCES = ["voice", "convex", "lib", "package.json", "package-lock.json"];

function uncommittedSources() {
  const status = execFileSync("git", ["status", "--porcelain", "--", ...IMAGE_SOURCES], { cwd: root, encoding: "utf8" });
  return status.split("\n").filter((line) => line.trim() !== "" && !line.includes("convex/_generated/"));
}

async function main() {
  const uncommitted = uncommittedSources();
  if (uncommitted.length > 0) {
    for (const line of uncommitted) console.error(`[deploy-guard] uncommitted: ${line.trim()}`);
    console.error("[deploy-guard] the image would ship these. Commit them, or deploy from a clean worktree of main.");
    process.exit(1);
  }
  if (process.env.FORCE_VOICE_DEPLOY === "1") {
    console.log("[deploy-guard] FORCE_VOICE_DEPLOY=1: deploying without checking for live calls");
    return;
  }
  const [onServer, realCalls] = await Promise.all([callsOnServer(), liveRealCalls()]);
  for (const call of realCalls) console.log(`[deploy-guard] live: ${call.address} (${call.stage}, ${call.direction})`);
  if (onServer === null) console.log("[deploy-guard] the server didn't report its calls; checked Convex only");
  const live = Math.max(onServer ?? 0, realCalls.length);
  if (live === 0) {
    console.log("[deploy-guard] no live calls");
    return;
  }
  console.error(`[deploy-guard] ${live} live call(s) would be dropped. Deploy after they end, or set FORCE_VOICE_DEPLOY=1.`);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error("[deploy-guard]", error);
  process.exit(1);
});
