// The recording stack: an isolated local Convex backend, the OR-Tools solver service and a
// production Next server pointed at that backend. Each runs detached with its pid in
// video/recordings/.stack/state.json, so `--keep` can leave it up for the next run to reuse.
// The team's deployment in .env.local is never read or written: deploys go through an env file
// naming only the local backend, and environment variables are set over its admin API.

import { ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const PORTS = { convex: 3330, convexSite: 3331, solver: 8899, app: 3340 } as const;

export type Stack = { convexUrl: string; adminKey: string; appUrl: string };

type State = { instanceSecret: string; adminKey: string; pids: Record<string, number> };

export function stackDir(root: string) {
  const dir = path.join(root, "video", "recordings", ".stack");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readState(dir: string): State | null {
  const file = path.join(dir, "state.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as State) : null;
}

function writeState(dir: string, state: State) {
  writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
}

function alive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function answers(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function waitFor(url: string, label: string, timeoutMs: number, child?: ChildProcess) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child && child.exitCode !== null) throw new Error(`${label} exited with code ${child.exitCode}`);
    if (await answers(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} did not answer at ${url} within ${timeoutMs / 1000}s`);
}

function startDetached(dir: string, name: string, command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) {
  const log = openSync(path.join(dir, `${name}.log`), "a");
  const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, detached: true, stdio: ["ignore", log, log] });
  child.unref();
  return child;
}

// The binary `npx convex dev --local` downloads, newest first. CONVEX_LOCAL_BACKEND overrides it.
function backendBinary() {
  if (process.env.CONVEX_LOCAL_BACKEND) return process.env.CONVEX_LOCAL_BACKEND;
  const root = path.join(os.homedir(), ".cache", "convex", "binaries");
  const found = existsSync(root)
    ? readdirSync(root)
        .map((version) => path.join(root, version, "convex-local-backend"))
        .filter((file) => existsSync(file))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (found.length === 0) throw new Error("No convex-local-backend binary. Run `npx convex dev --local` once, or set CONVEX_LOCAL_BACKEND.");
  return found[0];
}

async function ensureBackend(dir: string): Promise<State> {
  const binary = backendBinary();
  const previous = readState(dir);
  const url = `http://127.0.0.1:${PORTS.convex}`;
  if (previous && alive(previous.pids.convex) && (await answers(`${url}/version`))) return previous;
  const instanceSecret = previous?.instanceSecret ?? randomBytes(32).toString("hex");
  const { stdout } = await run(binary, ["keygen", "admin-key", "--instance-name", "standard-response-record", "--instance-secret", instanceSecret]);
  const child = startDetached(dir, "convex", binary, [
    "--interface", "127.0.0.1",
    "--port", String(PORTS.convex),
    "--site-proxy-port", String(PORTS.convexSite),
    "--instance-name", "standard-response-record",
    "--instance-secret", instanceSecret,
    "--local-storage", path.join(dir, "convex-storage"),
    "--disable-beacon",
    path.join(dir, "convex.sqlite3"),
  ], { cwd: dir });
  await waitFor(`${url}/version`, "Local Convex backend", 30_000, child);
  const state = { instanceSecret, adminKey: stdout.trim(), pids: { ...(previous?.pids ?? {}), convex: child.pid! } };
  writeState(dir, state);
  return state;
}

async function deployFunctions(root: string, dir: string, adminKey: string) {
  const envFile = path.join(dir, "deploy.env");
  writeFileSync(envFile, `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:${PORTS.convex}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`);
  await run("npx", ["convex", "deploy", "--env-file", envFile, "--typecheck", "disable", "--codegen", "disable", "-y"], {
    cwd: root,
    env: { ...process.env, CONVEX_DEPLOYMENT: undefined, CONVEX_DEPLOY_KEY: undefined, CONVEX_URL: undefined },
    maxBuffer: 32 * 1024 * 1024,
  });
}

// Over the backend's admin API, so no CLI reads .env.local on the way.
async function setBackendEnv(adminKey: string, values: Record<string, string>) {
  const response = await fetch(`http://127.0.0.1:${PORTS.convex}/api/update_environment_variables`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Convex ${adminKey}` },
    body: JSON.stringify({ changes: Object.entries(values).map(([name, value]) => ({ name, value })) }),
  });
  if (!response.ok) throw new Error(`Setting backend env failed: ${response.status} ${await response.text()}`);
}

async function ensureSolver(root: string, dir: string, state: State) {
  const url = `http://127.0.0.1:${PORTS.solver}/health`;
  if (alive(state.pids.solver) && (await answers(url))) return;
  const child = startDetached(dir, "solver", "uv", ["run", "--project", ".", "python", "server.py"], {
    cwd: path.join(root, "dispatch"),
    env: { ...process.env, PORT: String(PORTS.solver), SOLVER_HOST: "127.0.0.1", SOLVER_TOKEN: "" },
  });
  await waitFor(url, "Solver service", 180_000, child);
  state.pids.solver = child.pid!;
  writeState(dir, state);
}

const appEnv = () => ({
  ...process.env,
  NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${PORTS.convex}`,
  NEXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${PORTS.convexSite}`,
  CONVEX_DEPLOYMENT: "",
  AUTH0_DOMAIN: "",
  NEXT_TELEMETRY_DISABLED: "1",
});

// A production build renders the map more smoothly than `next dev` and holds less memory.
async function ensureApp(root: string, dir: string, state: State, build: boolean) {
  const url = `http://127.0.0.1:${PORTS.app}`;
  if (!build && alive(state.pids.app) && (await answers(url))) return;
  stopPid(state.pids.app);
  if (build || !existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.log("  building the app (next build) …");
    await run("npx", ["next", "build"], { cwd: root, env: appEnv(), maxBuffer: 64 * 1024 * 1024 });
  }
  const child = startDetached(dir, "app", "npx", ["next", "start", "-p", String(PORTS.app), "-H", "127.0.0.1"], { cwd: root, env: appEnv() });
  await waitFor(url, "Next server", 60_000, child);
  state.pids.app = child.pid!;
  writeState(dir, state);
}

export async function startStack(root: string, options: { build: boolean }): Promise<Stack> {
  const dir = stackDir(root);
  console.log("Starting the isolated stack …");
  const state = await ensureBackend(dir);
  console.log(`  convex backend at http://127.0.0.1:${PORTS.convex}, deploying convex/ …`);
  await deployFunctions(root, dir, state.adminKey);
  await setBackendEnv(state.adminKey, { SOLVER_URL: `http://127.0.0.1:${PORTS.solver}` });
  await ensureSolver(root, dir, state);
  console.log(`  solver at http://127.0.0.1:${PORTS.solver}`);
  await ensureApp(root, dir, state, options.build);
  console.log(`  app at http://127.0.0.1:${PORTS.app}`);
  return { convexUrl: `http://127.0.0.1:${PORTS.convex}`, adminKey: state.adminKey, appUrl: `http://127.0.0.1:${PORTS.app}` };
}

function stopPid(pid: number | undefined) {
  if (!alive(pid)) return;
  try {
    // Detached children lead their own process group, so this also stops what they spawned.
    process.kill(-pid!, "SIGTERM");
  } catch {
    process.kill(pid!, "SIGTERM");
  }
}

export function stopStack(root: string) {
  const dir = stackDir(root);
  const state = readState(dir);
  if (!state) return;
  for (const pid of Object.values(state.pids)) stopPid(pid);
  writeState(dir, { ...state, pids: {} });
}
