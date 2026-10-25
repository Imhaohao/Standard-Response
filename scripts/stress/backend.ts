// A throwaway Convex backend for the stress test: its own process, ports and database in a temp
// directory, with this repo's convex/ deployed to it. The deployment in .env.local is never touched.

import { ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, openSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Backend = { url: string; adminKey: string; dir: string; stop: (keep?: boolean) => void };

// The Convex CLI downloads the local backend into ~/.cache/convex/binaries/<version>/ the first time
// `npx convex dev --local` runs. CONVEX_LOCAL_BACKEND overrides it.
function backendBinary() {
  const override = process.env.CONVEX_LOCAL_BACKEND;
  if (override) return override;
  const root = path.join(os.homedir(), ".cache", "convex", "binaries");
  const found = existsSync(root)
    ? readdirSync(root)
        .map((version) => path.join(root, version, "convex-local-backend"))
        .filter((file) => existsSync(file))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (found.length === 0) {
    throw new Error("No convex-local-backend binary. Run `npx convex dev --local` once, or set CONVEX_LOCAL_BACKEND.");
  }
  return found[0];
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No port"))));
    });
  });
}

async function waitUntilUp(url: string, child: ChildProcess, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`Local backend exited with code ${child.exitCode}`);
    try {
      if ((await fetch(`${url}/version`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Local backend at ${url} did not come up in ${timeoutMs / 1000}s`);
}

async function deploy(repoRoot: string, dir: string, url: string, adminKey: string) {
  const envFile = path.join(dir, "deploy.env");
  writeFileSync(envFile, `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`);
  await run("npx", ["convex", "deploy", "--env-file", envFile, "--typecheck", "disable", "--codegen", "disable", "-y"], {
    cwd: repoRoot,
    // .env.local names the team's deployment; the env file above must be the only target.
    env: { ...process.env, CONVEX_DEPLOYMENT: undefined, CONVEX_DEPLOY_KEY: undefined },
    maxBuffer: 16 * 1024 * 1024,
  });
}

export async function startBackend(repoRoot: string): Promise<Backend> {
  const binary = backendBinary();
  const dir = mkdtempSync(path.join(os.tmpdir(), "convex-stress-"));
  const instanceName = "convex-stress";
  const instanceSecret = randomBytes(32).toString("hex");
  const { stdout } = await run(binary, ["keygen", "admin-key", "--instance-name", instanceName, "--instance-secret", instanceSecret]);
  const adminKey = stdout.trim();
  const [port, sitePort] = [await freePort(), await freePort()];
  const url = `http://127.0.0.1:${port}`;
  const log = openSync(path.join(dir, "backend.log"), "a");
  const child = spawn(
    binary,
    [
      "--interface", "127.0.0.1",
      "--port", String(port),
      "--site-proxy-port", String(sitePort),
      "--instance-name", instanceName,
      "--instance-secret", instanceSecret,
      "--local-storage", path.join(dir, "storage"),
      "--disable-beacon",
      path.join(dir, "backend.sqlite3"),
    ],
    { stdio: ["ignore", log, log] },
  );
  const stop = (keep = false) => {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (!keep) rmSync(dir, { recursive: true, force: true });
  };
  try {
    await waitUntilUp(url, child);
    await deploy(repoRoot, dir, url, adminKey);
  } catch (error) {
    stop(true);
    throw new Error(`${error instanceof Error ? error.message : error}\nBackend log: ${path.join(dir, "backend.log")}`);
  }
  return { url, adminKey, dir, stop };
}
