"use client";

import { CheckCircle, Exam, Scales, XCircle } from "@phosphor-icons/react";
import { Tag } from "../ui/tag";
import { Disclosure, PendingDisclosure } from "./disclosure";
import { RangeRow } from "./range";
import { Alignment, AlignmentEval, percent, VoiceExam } from "./results";

const PARITY_ROWS = [
  { key: "allFieldsCorrect", label: "Every field right", format: (value: number) => percent(value, 1) },
  { key: "pressurePass", label: "Holds under pressure", format: (value: number) => percent(value) },
  { key: "injectionPass", label: "Ignores spoken instructions", format: (value: number) => percent(value) },
  { key: "turnMsP50", label: "Median turn", format: (value: number) => `${Math.round(value).toLocaleString()} ms` },
] as const;

const SET_LABELS: Record<string, string> = { pressure: "Pushed for a promise", injection: "Spoken instructions", barrier: "Can't understand" };

const scored = (entry: AlignmentEval): entry is AlignmentEval & { rate: number; ci95: [number, number] } => entry.rate !== undefined && entry.rate !== null && entry.ci95 !== undefined;

function SpanishParity({ entry }: { entry: AlignmentEval }) {
  const languages = entry.byLanguage;
  if (!languages) return null;
  return (
    <table className="type-small w-full tabular-nums">
      <caption className="pb-1 text-left font-semibold">{entry.name}</caption>
      <thead className="text-on-panel-muted">
        <tr>
          <th className="py-1 text-left font-normal" scope="col">
            <span className="sr-only">Measure</span>
          </th>
          <th className="py-1 text-right font-normal" scope="col">English</th>
          <th className="py-1 text-right font-normal" scope="col">Spanish</th>
        </tr>
      </thead>
      <tbody>
        {PARITY_ROWS.filter(({ key }) => languages.en[key] !== undefined).map(({ key, label, format }) => (
          <tr key={key}>
            <th className="py-1 text-left font-normal text-on-panel-muted" scope="row">{label}</th>
            <td className="py-1 text-right">{format(languages.en[key])}</td>
            <td className="py-1 text-right">{format(languages.es[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Track D's red-team sets against the live text agent: pressure for a promise, instructions spoken
// at it, callers it can't understand. Each pass rate is drawn with its interval.
export function AlignmentDisclosure({ alignment }: { alignment: Alignment | null }) {
  if (!alignment) return <PendingDisclosure icon={Scales} title="Red-team sets" />;
  const sets = alignment.evals.filter(scored);
  const parity = alignment.evals.find((entry) => entry.key === "spanishParity");
  const waiting = alignment.evals.filter((entry) => entry.status);
  return (
    <Disclosure icon={Scales} title="Red-team sets" fact={`${sets.length} sets, graded by ${alignment.grader}`}>
      <Tag>Simulated residents, not real riders</Tag>
      <ul>
        {sets.map((entry) => (
          <RangeRow
            key={entry.name}
            label={<span title={entry.description}>{SET_LABELS[entry.key ?? ""] ?? entry.name}</span>}
            value={entry.rate}
            low={entry.ci95[0]}
            high={entry.ci95[1]}
            domain={[0, 1]}
            readout={`${entry.passed} of ${entry.total}`}
          />
        ))}
      </ul>
      {parity && <SpanishParity entry={parity} />}
      {waiting.map((entry) => (
        <p key={entry.name} className="type-small text-on-panel-muted">
          {entry.name}: {entry.status}
        </p>
      ))}
    </Disclosure>
  );
}

function ModuleRow({ module }: { module: VoiceExam["modules"][number] }) {
  const StateIcon = module.pass ? CheckCircle : XCircle;
  return (
    <li className="flex items-center gap-2 py-1" title={module.measures}>
      <StateIcon weight={module.pass ? "fill" : "regular"} className={`size-4 shrink-0 ${module.pass ? "" : "text-on-panel-muted"}`} aria-label={module.pass ? "Passed" : "Not passed"} />
      <span className={`type-small min-w-0 flex-1 truncate ${module.pass ? "" : "font-bold"}`}>{module.name}</span>
      <span className="type-small tabular-nums text-on-panel-muted">
        {module.passed} of {module.total}
      </span>
    </li>
  );
}

// The CritiCall-style dispatcher test, adapted from released 911 calls. A module passes at the bar.
export function VoiceExamDisclosure({ exam }: { exam: VoiceExam | null }) {
  if (!exam) return <PendingDisclosure icon={Exam} title="Dispatcher exam" />;
  const passed = exam.modules.filter((module) => module.pass).length;
  return (
    <Disclosure icon={Exam} title="Dispatcher exam" fact={`${passed} of ${exam.modules.length} modules at the ${percent(exam.passBar)} bar`}>
      <Tag>{`${exam.items} scripted callers from released 911 calls`}</Tag>
      <ul className="grid gap-x-6 sm:grid-cols-2">
        {[...exam.modules].sort((a, b) => Number(a.pass) - Number(b.pass)).map((module) => (
          <ModuleRow key={module.module} module={module} />
        ))}
      </ul>
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="type-small text-on-panel-muted">Median turn</dt>
          <dd className="type-figure text-2xl tabular-nums">{exam.latencyMs.p50.toLocaleString()} ms</dd>
        </div>
        <div>
          <dt className="type-small text-on-panel-muted">95th percentile</dt>
          <dd className="type-figure text-2xl tabular-nums">{exam.latencyMs.p95.toLocaleString()} ms</dd>
        </div>
        <div>
          <dt className="type-small text-on-panel-muted">Budget</dt>
          <dd className="type-figure text-2xl tabular-nums text-on-panel-muted">{exam.latencyMs.budget.toLocaleString()} ms</dd>
        </div>
      </dl>
    </Disclosure>
  );
}
