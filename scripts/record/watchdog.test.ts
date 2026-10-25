import assert from "node:assert/strict";
import { test } from "node:test";
import { chromeTree, parseTopMemory, topFootprints } from "./watchdog";

const row = (pid: number, ppid: number, mb: number, command: string) => ({ pid, ppid, rssBytes: mb * 1024 ** 2, command });

test("the Chrome tree is the browser this process started and everything under it", () => {
  const rows = [
    row(100, 1, 50, "node"),
    row(200, 100, 300, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    row(201, 200, 14_000, "Google Chrome Helper (GPU)"),
    row(202, 200, 400, "Google Chrome Helper (Renderer)"),
    row(203, 202, 10, "some grandchild"),
    row(300, 1, 900, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    row(301, 300, 2_000, "Google Chrome Helper (GPU)"),
    row(400, 100, 80, "ffmpeg"),
  ];
  const tree = chromeTree(rows, 100);
  assert.deepEqual(tree.map((r) => r.pid).sort(), [200, 201, 202, 203]);
  assert.equal(tree.reduce((sum, r) => sum + r.rssBytes, 0), (300 + 14_000 + 400 + 10) * 1024 ** 2);
});

test("no browser started means an empty tree", () => {
  assert.deepEqual(chromeTree([row(1, 0, 1, "launchd")], 100), []);
});

test("top's MEM column reads as bytes, whatever its unit", () => {
  assert.equal(parseTopMemory("874M"), 874 * 1024 ** 2);
  assert.equal(parseTopMemory("1.5G+"), 1.5 * 1024 ** 3);
  assert.equal(parseTopMemory("512K-"), 512 * 1024);
  assert.equal(parseTopMemory("n/a"), 0);
});

test("footprints come from top's pid and mem rows only", () => {
  const stdout = "Processes: 3 total\nPhysMem: 15G used\n\nPID    MEM\n201    13G\n202    410M+\n";
  assert.deepEqual([...topFootprints(stdout)], [
    [201, 13 * 1024 ** 3],
    [202, 410 * 1024 ** 2],
  ]);
});
