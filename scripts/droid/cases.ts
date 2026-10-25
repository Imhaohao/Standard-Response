// Turns the voice exam's results file into the failed cases a Droid should look at.

export type ExamCheck = { module: string; name: string; pass: boolean; critical?: boolean; detail?: string };
export type ExamCall = { item: string; run: number; title: string; checks: ExamCheck[]; transcript: string[] };
export type ExamResults = { generatedAt: string; calls: ExamCall[] };

export type FailedCheck = { module: string; name: string; critical: boolean; detail: string };
export type FailedCase = {
  caseId: string;
  item: string;
  run: number;
  title: string;
  judgeReason: string;
  failedChecks: FailedCheck[];
  transcript: string[];
  critical: boolean;
};

export const CASE_CAP = 5;

// A slow turn is a latency problem, not a wording or logic fault in the agent's code.
const NOT_FIXABLE_IN_CODE = new Set(["speed"]);

const toFailedCheck = (check: ExamCheck): FailedCheck => ({
  module: check.module,
  name: check.name,
  critical: check.critical === true,
  detail: check.detail ?? "",
});

function toCase(call: ExamCall): FailedCase | undefined {
  const failedChecks = call.checks.filter((check) => !check.pass && !NOT_FIXABLE_IN_CODE.has(check.module)).map(toFailedCheck);
  if (failedChecks.length === 0) return undefined;
  return {
    caseId: `${call.item}#${call.run}`,
    item: call.item,
    run: call.run,
    title: call.title,
    judgeReason: failedChecks.map((check) => `${check.name}: ${check.detail || "failed"}`).join(" | "),
    failedChecks,
    transcript: call.transcript,
    critical: failedChecks.some((check) => check.critical),
  };
}

const severity = (failed: FailedCase) => (failed.critical ? 1000 : 0) + failed.failedChecks.length;

export function failedCases(results: ExamResults): FailedCase[] {
  return results.calls
    .map(toCase)
    .filter((entry): entry is FailedCase => entry !== undefined)
    .sort((a, b) => severity(b) - severity(a));
}
