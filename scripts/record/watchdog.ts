// The recorder's memory watchdog. The team shares one 16 GB laptop, and on a Mac GPU memory comes out
// of the same RAM: a Chrome GPU helper once grew to 14 GB and froze the machine. From the moment
// Chrome launches until it closes, every second, this reads the system's free memory and the
// resident size of Chrome's whole process tree (GPU helper and renderers included), and SIGKILLs
// that tree the moment either crosses its line. Every wait and hold in the recorder calls
// `assertHealthy`, so the run stops within a second of a kill.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const MIN_FREE_PERCENT = 25;
export const MAX_CHROME_TREE_BYTES = 3 * 1024 ** 3;
const POLL_MS = 1000;

export async function freeMemoryPercent() {
  const { stdout } = await run("memory_pressure", []);
  const match = stdout.match(/free percentage:\s*(\d+)%/);
  if (!match) throw new Error("Couldn't read memory_pressure; not recording blind");
  return Number(match[1]);
}

type ProcessRow = { pid: number; ppid: number; rssBytes: number; command: string };

async function processTable(): Promise<ProcessRow[]> {
  const { stdout } = await run("ps", ["-axo", "pid=,ppid=,rss=,comm="], { maxBuffer: 16 * 1024 * 1024 });
  return stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .flatMap((match) => (match ? [{ pid: Number(match[1]), ppid: Number(match[2]), rssBytes: Number(match[3]) * 1024, command: match[4] }] : []));
}

// Chrome processes Playwright started: children of this Node process, and all of their descendants.
export function chromeTree(rows: ProcessRow[], parentPid: number) {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const roots = (children.get(parentPid) ?? []).filter((row) => /chrome/i.test(row.command));
  const tree: ProcessRow[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const row = stack.pop()!;
    tree.push(row);
    stack.push(...(children.get(row.pid) ?? []));
  }
  return tree;
}

const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export class Watchdog {
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  tripped: string | null = null;
  peak = { treeBytes: 0, lowestFree: 100 };

  start() {
    this.stop();
    this.tripped = null;
    this.timer = setInterval(() => void this.check(), POLL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async check() {
    if (this.checking || this.tripped) return;
    this.checking = true;
    try {
      const [free, rows] = await Promise.all([freeMemoryPercent(), processTable()]);
      const tree = chromeTree(rows, process.pid);
      const treeBytes = tree.reduce((sum, row) => sum + row.rssBytes, 0);
      this.peak = { treeBytes: Math.max(this.peak.treeBytes, treeBytes), lowestFree: Math.min(this.peak.lowestFree, free) };
      const reason = free < MIN_FREE_PERCENT ? `free memory fell to ${free}%` : treeBytes > MAX_CHROME_TREE_BYTES ? `Chrome grew to ${gigabytes(treeBytes)}` : null;
      if (reason) this.trip(reason, tree);
    } catch (error) {
      this.trip(`the memory check itself failed (${error instanceof Error ? error.message : error})`, []);
    } finally {
      this.checking = false;
    }
  }

  private trip(reason: string, tree: ProcessRow[]) {
    this.tripped = reason;
    this.stop();
    const pids = tree.length > 0 ? tree.map((row) => row.pid) : [];
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    console.error(`  WATCHDOG: ${reason}. Killed Chrome (${pids.length} processes).`);
  }

  // Throws once the watchdog has fired, so whatever the recorder was waiting on stops at once.
  assertHealthy() {
    if (this.tripped) throw new Error(`Stopped by the memory watchdog: ${this.tripped}`);
  }
}

// One browser at a time, so one watchdog for the whole run.
export const watchdog = new Watchdog();
