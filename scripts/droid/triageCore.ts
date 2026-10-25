import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FailedCase } from "./cases";
import { DroidPermissions, restrictedPermissions, TEST_COMMAND } from "./policy";

// One Droid session per failed exam case. The Droid works in a scratch copy of the repo and never
// touches the real files: the diff below is computed by us from the copy, not reported by the model.

export type DroidSessionRequest = { prompt: string; permissions: DroidPermissions };
export type DroidSessionResult = { sessionId: string; finalText: string };
export interface DroidClient {
  runSession(request: DroidSessionRequest): Promise<DroidSessionResult>;
}

export type TestResult = { ran: boolean; passed: boolean; exitCode: number | null; summary: string };
export type TriageEntry = {
  caseId: string;
  item: string;
  run: number;
  judgeReason: string;
  failedChecks: FailedCase["failedChecks"];
  plan: string[];
  diagnosis: string;
  diff: string;
  testResult: TestResult;
  sessionId: string;
  resumeCommand: string;
  error?: string;
};

export type TriageDeps = {
  client: DroidClient;
  repoRoot: string;
  runTests?: (workspace: string) => TestResult;
};

const COPIED_DIRECTORIES = ["voice", "convex", "lib"];

function buildWorkspace(failed: FailedCase, repoRoot: string, examResultsFile: string) {
  const root = mkdtempSync(join(tmpdir(), "droid-triage-"));
  const work = join(root, "work");
  const base = join(root, "base");
  const skipJunk = (source: string) => !source.endsWith(".DS_Store");
  mkdirSync(work);
  for (const directory of COPIED_DIRECTORIES) cpSync(join(repoRoot, directory), join(work, directory), { recursive: true, filter: skipJunk });
  cpSync(join(repoRoot, "voice"), join(base, "voice"), { recursive: true, filter: skipJunk });
  for (const file of ["package.json", "tsconfig.json"]) if (existsSync(join(repoRoot, file))) cpSync(join(repoRoot, file), join(work, file));
  if (existsSync(join(repoRoot, "node_modules"))) symlinkSync(join(repoRoot, "node_modules"), join(work, "node_modules"));
  mkdirSync(join(work, "data"));
  if (existsSync(examResultsFile)) cpSync(examResultsFile, join(work, "data", "voice-exam-results.json"));
  writeFileSync(join(work, "case.json"), `${JSON.stringify(failed, null, 1)}\n`);
  return { root, work, base };
}

export function promptFor(failed: FailedCase): string {
  return [
    "You are triaging one failed case from the voice exam of an evacuation call agent.",
    "Everything you need is in your working directory: case.json (the transcript, the failed checks and the judge's reasons),",
    "voice/agent/ (the agent's prompts, lines and logic, which failures usually trace to), and voice/exam/ (how the case is graded).",
    "",
    "1. Read case.json, then the agent code that produced the failing line.",
    "2. Edit the smallest amount of code under voice/agent/ that fixes the cause. Do not touch voice/exam/, tests, or anything outside voice/.",
    `3. Run \`${TEST_COMMAND}\` to check your change. It is the only command you may run.`,
    "4. Finish with one fenced json block and nothing after it:",
    '   {"plan": ["step you took", ...], "diagnosis": "one paragraph: what went wrong and why this change fixes it"}',
    "",
    `Failed case: ${failed.caseId} (${failed.title})`,
    `Judge's reason: ${failed.judgeReason}`,
    "You cannot commit, push, or reach the network. A person reviews your diff afterwards.",
  ].join("\n");
}

const JSON_BLOCK = /```json\s*([\s\S]*?)```/g;

export function parseReport(finalText: string): { plan: string[]; diagnosis: string } {
  const blocks = [...finalText.matchAll(JSON_BLOCK)];
  const last = blocks[blocks.length - 1]?.[1] ?? finalText;
  try {
    const parsed = JSON.parse(last) as { plan?: unknown; diagnosis?: unknown };
    const plan = Array.isArray(parsed.plan) ? parsed.plan.map(String) : [];
    return { plan, diagnosis: typeof parsed.diagnosis === "string" ? parsed.diagnosis : finalText.trim() };
  } catch {
    return { plan: [], diagnosis: finalText.trim() };
  }
}

export function unifiedDiff(root: string): string {
  const result = spawnSync("git", ["diff", "--no-index", "--no-color", "--", "base/voice", "work/voice"], { cwd: root, encoding: "utf8" });
  return result.stdout.replaceAll("a/base/voice/", "a/voice/").replaceAll("b/work/voice/", "b/voice/");
}

const NO_TESTS: TestResult = { ran: false, passed: false, exitCode: null, summary: "no change proposed, tests not run" };

function testsInWorkspace(workspace: string): TestResult {
  const result = spawnSync("sh", ["-c", TEST_COMMAND], { cwd: workspace, encoding: "utf8", timeout: 180_000 });
  const lines = `${result.stdout}\n${result.stderr}`.split("\n");
  const count = (label: string) => lines.find((line) => line.startsWith(`ℹ ${label} `))?.replace("ℹ ", "") ?? "";
  return { ran: true, passed: result.status === 0, exitCode: result.status, summary: [count("tests"), count("pass"), count("fail")].filter(Boolean).join(", ") };
}

export async function triageCase(failed: FailedCase, deps: TriageDeps, examResultsFile: string): Promise<TriageEntry> {
  const { root, work } = buildWorkspace(failed, deps.repoRoot, examResultsFile);
  const base = { caseId: failed.caseId, item: failed.item, run: failed.run, judgeReason: failed.judgeReason, failedChecks: failed.failedChecks };
  try {
    const session = await deps.client.runSession({ prompt: promptFor(failed), permissions: restrictedPermissions(work, deps.repoRoot) });
    const diff = unifiedDiff(root);
    const testResult = diff ? (deps.runTests ?? testsInWorkspace)(work) : NO_TESTS;
    const report = parseReport(session.finalText);
    return { ...base, ...report, diff, testResult, sessionId: session.sessionId, resumeCommand: `droid exec --session-id ${session.sessionId}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, plan: [], diagnosis: "", diff: "", testResult: NO_TESTS, sessionId: "", resumeCommand: "", error: message };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
