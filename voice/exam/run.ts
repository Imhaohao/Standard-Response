import { writeFileSync } from "node:fs";
import { CallOutcome, runCall } from "./call";
import { defaultChecks } from "./grade";
import { ITEMS } from "./items";
import { judge } from "./judge";
import { Check, ModuleId, MODULES, NOT_SCORED, PASS_BAR, TURN_BUDGET_MS } from "./rubric";
import { SOURCES } from "./sources";

// The voice exam: every item's call against the real agent, graded by deterministic checks and a
// judge model, scored per module after CritiCall. Exits 1 unless every module clears PASS_BAR with
// no critical error, so an improvement loop can run it until it passes.
//
//   npm run exam:voice                       all items, one run each
//   npm run exam:voice -- --only decision    one module's items, or one item id
//   npm run exam:voice -- --runs 3           certify: every run of every item counts
//   npm run exam:voice -- --no-judge         quick loop; conduct and part of honesty go ungraded

const RESULTS_FILE = "data/voice-exam-results.json";
const CONCURRENCY = 6;

type Options = { only?: string; runs: number; judged: boolean };

function optionsFrom(argv: string[]): Options {
  const valueOf = (flag: string) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  return { only: valueOf("--only"), runs: Math.max(1, Number(valueOf("--runs") ?? 1)), judged: !argv.includes("--no-judge") };
}

type Graded = { call: CallOutcome; checks: Check[] };

async function grade(call: CallOutcome, judged: boolean): Promise<Graded> {
  const expectations = [...call.item.expect, ...defaultChecks];
  const deterministic = expectations.flatMap((expect) => expect(call));
  const judgedChecks = judged && !call.error ? await judge(call) : [];
  return { call, checks: [...deterministic, ...judgedChecks] };
}

async function pooled<T, R>(inputs: T[], work: (input: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(inputs.length);
  let next = 0;
  const worker = async () => {
    while (next < inputs.length) {
      const index = next++;
      results[index] = await work(inputs[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, inputs.length) }, worker));
  return results;
}

type ModuleScore = { module: ModuleId; name: string; criticall: string; passed: number; total: number; score: number | null; pass: boolean };

function moduleScores(graded: Graded[]): ModuleScore[] {
  return (Object.keys(MODULES) as ModuleId[]).map((module) => {
    const checks = graded.flatMap((entry) => entry.checks).filter((check) => check.module === module);
    const passed = checks.filter((check) => check.pass).length;
    const score = checks.length ? passed / checks.length : null;
    return { module, ...MODULES[module], passed, total: checks.length, score, pass: score !== null && score >= PASS_BAR };
  });
}

const failuresOf = (graded: Graded[]) =>
  graded.flatMap(({ call, checks }) =>
    checks
      .filter((check) => !check.pass)
      .map((check) => ({ item: call.item.id, run: call.run, module: check.module, check: check.name, critical: check.critical === true, detail: check.detail })),
  );

const latencies = (graded: Graded[]) =>
  graded
    .flatMap(({ call }) => call.lines)
    .flatMap((line) => (line.speaker === "agent" && line.ms !== undefined ? [line.ms] : []))
    .sort((a, b) => a - b);

const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

function report(graded: Graded[], options: Options) {
  const modules = moduleScores(graded);
  const failures = failuresOf(graded);
  const critical = failures.filter((failure) => failure.critical);
  const sorted = latencies(graded);
  const passed = options.judged && critical.length === 0 && modules.every((module) => module.pass);
  // Every module weighs the same, so many speed checks can't drown out a few decision checks.
  const overall = modules.reduce((sum, scored) => sum + (scored.score ?? 0), 0) / modules.length;
  return {
    label: "Voice exam after the CritiCall dispatcher test. Scripted callers adapted from released 911 calls, not real riders.",
    generatedAt: new Date().toISOString(),
    agentModel: process.env.VOICE_MODEL || "claude-opus-5-5 (fast mode)",
    passBar: PASS_BAR,
    overallScore: Number(overall.toFixed(3)),
    verdict: passed ? "PASS" : "FAIL",
    certified: passed && options.runs >= 3,
    runs: options.runs,
    judged: options.judged,
    items: new Set(graded.map(({ call }) => call.item.id)).size,
    callCount: graded.length,
    criticalFailures: critical.length,
    latencyMs: { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), budget: TURN_BUDGET_MS },
    modules,
    notScored: NOT_SCORED,
    failures,
    calls: graded.map(({ call, checks }) => ({
      item: call.item.id,
      run: call.run,
      title: call.item.title,
      sources: call.item.sources.map((source) => SOURCES[source].url),
      endedAs: call.endedAs,
      unscripted: call.unscripted,
      record: call.record,
      escalations: call.escalations,
      nominations: call.nominations,
      error: call.error,
      checks,
      transcript: call.lines.map((line) =>
        line.speaker === "agent" ? `agent [${line.step}/${line.status}${line.ms ? ` ${line.ms}ms` : ""}]: ${line.ignored ? "(nothing)" : line.text}` : `caller: ${line.text ?? "(silence)"}`,
      ),
    })),
  };
}

const percent = (score: number | null) => (score === null ? "  -  " : `${(score * 100).toFixed(0).padStart(3)}%`);

function print(result: ReturnType<typeof report>) {
  console.log(`\nVoice exam: ${result.verdict}${result.certified ? " (certified)" : ""}  overall ${percent(result.overallScore).trim()}  ${result.items} items, ${result.callCount} calls, pass bar ${result.passBar * 100}% per module`);
  for (const scored of result.modules) {
    const mark = scored.score === null ? "no checks" : scored.pass ? "pass" : "FAIL";
    console.log(`  ${percent(scored.score)}  ${scored.name.padEnd(20)} ${`${scored.passed}/${scored.total}`.padStart(7)}  ${mark}`);
  }
  console.log(`  Turn latency p50 ${result.latencyMs.p50} ms, p95 ${result.latencyMs.p95} ms (budget ${result.latencyMs.budget} ms)`);
  console.log(`  Critical failures: ${result.criticalFailures}${result.judged ? "" : "  (judge off: the exam can't pass)"}`);
  for (const failure of result.failures.filter((entry) => entry.module !== "speed")) {
    console.log(`  ${failure.critical ? "CRITICAL" : "fail    "} ${failure.item}#${failure.run} ${failure.module}: ${failure.check}${failure.detail ? ` - ${failure.detail}` : ""}`);
  }
  console.log(`\nTranscripts and every check: ${RESULTS_FILE}`);
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  const items = ITEMS.filter((item) => !options.only || item.id === options.only || item.module === options.only);
  if (items.length === 0) throw new Error(`No exam item or module named ${options.only}`);
  const jobs = items.flatMap((item) => Array.from({ length: options.runs }, (_, run) => ({ item, run: run + 1 })));
  const graded = await pooled(jobs, async ({ item, run }) => grade(await runCall(item, run), options.judged));
  const result = report(graded, options);
  writeFileSync(RESULTS_FILE, `${JSON.stringify(result, null, 1)}\n`);
  print(result);
  process.exitCode = result.verdict === "PASS" ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
