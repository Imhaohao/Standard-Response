import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CASE_CAP, ExamResults, failedCases } from "./cases";
import { FactoryDroidClient } from "./sdkClient";
import { DroidClient, TestResult, TriageEntry, triageCase } from "./triageCore";

// Hands each failed voice-exam case to a Droid, which proposes a minimal fix as a diff and a
// diagnosis. It never commits, and it works on a scratch copy; see policy.ts for what it may do.
//
//   npm run exam:triage            triage the latest data/voice-exam-results.json
//   npm run exam:voice             runs it at the end when FACTORY_API_KEY is set

export const RESULTS_FILE = "data/voice-exam-results.json";
export const TRIAGE_FILE = "data/droid-triage.json";

const MISSING_KEY_MESSAGE = [
  "Droid triage skipped: FACTORY_API_KEY is not set.",
  "  1. Create a key at https://app.factory.ai (Settings, API keys).",
  "  2. Install the Droid CLI (https://docs.factory.ai/cli) so `droid` is on your PATH.",
  "  3. Add FACTORY_API_KEY=... to .env.local, then run `npm run exam:triage`.",
].join("\n");

export type TriageOptions = {
  repoRoot: string;
  apiKey: string | undefined;
  client?: DroidClient;
  runTests?: (workspace: string) => TestResult;
  resultsFile?: string;
  outFile?: string;
  log?: (line: string) => void;
};

const verdictOf = (entry: TriageEntry) => {
  if (entry.error) return "error";
  if (!entry.diff) return "no diff";
  return entry.testResult.passed ? "tests pass" : "tests FAIL";
};

export function triageTable(entries: TriageEntry[]): string {
  const rows = entries.map((entry) => [entry.caseId, verdictOf(entry), `${entry.diff.split("\n").filter((line) => /^[+-][^+-]/.test(line)).length} lines`, entry.sessionId || "-"]);
  const widths = [0, 1, 2, 3].map((column) => Math.max(...[["case", "result", "changed", "session"], ...rows].map((row) => row[column].length)));
  return [["case", "result", "changed", "session"], ...rows].map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ")).join("\n");
}

export async function runTriage(options: TriageOptions): Promise<number> {
  const log = options.log ?? console.log;
  if (!options.apiKey) {
    log(MISSING_KEY_MESSAGE);
    return 0;
  }
  const resultsFile = resolve(options.repoRoot, options.resultsFile ?? RESULTS_FILE);
  if (!existsSync(resultsFile)) {
    log(`No exam results at ${resultsFile}. Run \`npm run exam:voice\` first.`);
    return 0;
  }
  const results = JSON.parse(readFileSync(resultsFile, "utf8")) as ExamResults;
  const failed = failedCases(results);
  const client = options.client ?? new FactoryDroidClient();
  const entries: TriageEntry[] = [];
  for (const failure of failed.slice(0, CASE_CAP)) entries.push(await triageCase(failure, { client, repoRoot: options.repoRoot, runTests: options.runTests }, resultsFile));
  const outFile = resolve(options.repoRoot, options.outFile ?? TRIAGE_FILE);
  const report = { generatedAt: new Date().toISOString(), examGeneratedAt: results.generatedAt, failedCases: failed.length, triaged: entries.length, cases: entries };
  writeFileSync(outFile, `${JSON.stringify(report, null, 1)}\n`);
  log(entries.length ? `\n${triageTable(entries)}\n\nDiffs and diagnoses: ${TRIAGE_FILE}. Nothing was committed or applied.` : "No failed exam cases to triage.");
  return 0;
}

if (process.argv[1]?.endsWith("triage.ts")) {
  runTriage({ repoRoot: process.cwd(), apiKey: process.env.FACTORY_API_KEY }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
