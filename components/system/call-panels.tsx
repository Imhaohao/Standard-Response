"use client";

import { useQuery } from "convex/react";
import { CheckCircle, ListChecks, ShieldCheck, Target, Timer, XCircle } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Disclosure } from "./disclosure";
import { RangeRow, Tag } from "./range";
import { ChangeCases, Evaluation, Honesty, percent, Rate } from "./results";

const PLAN_FIELDS = [
  { key: "address", label: "Address" },
  { key: "peopleCount", label: "People" },
  { key: "mobility", label: "Mobility" },
  { key: "assistanceRequired", label: "Help needed" },
  { key: "canLeave", label: "Can leave" },
  { key: "oxygen", label: "Oxygen" },
] as const;

const CORRECTION_LABELS: Record<string, string> = { next_turn: "Next turn", readback: "At read-back", second_voice: "Second voice" };

const STATUS_LABELS: Record<string, string> = { none: "No request yet", received: "Waiting for a driver", reassigning: "Finding a new driver", approved: "Offer sent" };

export const accuracyOf = (rate: Rate) => rate.accuracy ?? rate.rate ?? 0;
const rangeReadout = (rate: Rate) => `${percent(accuracyOf(rate))} (${percent(rate.ci95[0])}–${percent(rate.ci95[1])})`;

function AccuracyRow({ label, rate, emphasis = false }: { label: string; rate: Rate; emphasis?: boolean }) {
  return <RangeRow label={label} value={accuracyOf(rate)} low={rate.ci95[0]} high={rate.ci95[1]} domain={[0.8, 1]} readout={rangeReadout(rate)} emphasis={emphasis} />;
}

function Pending({ title }: { title: string }) {
  return (
    <Disclosure icon={ListChecks} title={title} fact="–">
      <p className="type-small text-on-panel-muted">No results file yet.</p>
    </Disclosure>
  );
}

export function FieldAccuracyDisclosure({ evaluation }: { evaluation: Evaluation | null }) {
  if (!evaluation) return <Pending title="Field by field" />;
  const fields = PLAN_FIELDS.filter(({ key }) => evaluation.fields[key]);
  const weakest = Math.min(...fields.map(({ key }) => accuracyOf(evaluation.fields[key])));
  return (
    <Disclosure icon={Target} title="Field by field" fact={`${fields.length} fields, lowest ${percent(weakest)}`}>
      <ul>
        {fields.map(({ key, label }) => (
          <AccuracyRow key={key} label={label} rate={evaluation.fields[key]} />
        ))}
      </ul>
      <p className="type-small text-on-panel-muted">
        {evaluation.completed} of {evaluation.personas} personas
      </p>
    </Disclosure>
  );
}

export function CorrectionsDisclosure({ evaluation }: { evaluation: Evaluation | null }) {
  if (!evaluation) return <Pending title="Corrections" />;
  const { corrections } = evaluation;
  return (
    <Disclosure icon={CheckCircle} title="Corrections caught" fact={`${corrections.correct} of ${corrections.total}`}>
      <ul>
        {Object.entries(corrections.byWhen).map(([when, rate]) => (
          <AccuracyRow key={when} label={CORRECTION_LABELS[when] ?? when} rate={rate} />
        ))}
      </ul>
    </Disclosure>
  );
}

export function HonestyDisclosure({ honesty }: { honesty: Honesty | null }) {
  if (!honesty) return <Pending title="Honesty by status" />;
  const statuses = Object.entries(honesty.byStatus).flatMap(([status, rate]) => (rate ? [{ status, rate }] : []));
  return (
    <Disclosure icon={ShieldCheck} title="Honesty by status" fact={`${honesty.linesGraded.toLocaleString()} agent lines graded`}>
      <ul>
        {statuses.map(({ status, rate }) => (
          <RangeRow
            key={status}
            label={STATUS_LABELS[status] ?? status}
            value={rate.rate ?? 0}
            low={rate.ci95[0]}
            high={rate.ci95[1]}
            domain={[0, 0.05]}
            readout={`${percent(rate.rate ?? 0, 1)} of ${rate.graded}`}
          />
        ))}
      </ul>
      <p className="type-small text-on-panel-muted">
        Keyword check alone: {percent(honesty.lexical.rate ?? 0, 2)} of {honesty.lexical.graded} lines
      </p>
    </Disclosure>
  );
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function LatencyDisclosure({ evaluation }: { evaluation: Evaluation | null }) {
  const lines = useQuery(api.estimates.agentLines, { limit: 1000 });
  const latencies = (lines ?? []).flatMap((line) => (line.latencyMs === null ? [] : [line.latencyMs])).sort((a, b) => a - b);
  const live = latencies.length > 0;
  const median = live ? quantile(latencies, 0.5) : evaluation?.latency.turnMsP50;
  const slowest = live ? quantile(latencies, 0.95) : evaluation?.latency.turnMsP95;
  const format = (value: number | undefined) => (value === undefined ? "–" : `${Math.round(value).toLocaleString()} ms`);
  return (
    <Disclosure icon={Timer} title="Turn latency" fact={`median ${format(median)}`}>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="type-small text-on-panel-muted">Median</dt>
          <dd className="type-figure text-3xl">{format(median)}</dd>
        </div>
        <div>
          <dt className="type-small text-on-panel-muted">95th percentile</dt>
          <dd className="type-figure text-3xl">{format(slowest)}</dd>
        </div>
      </dl>
      <p className="type-small text-on-panel-muted">{live ? `${latencies.length} live turns` : "Text eval"}</p>
    </Disclosure>
  );
}

export function ChangeCasesDisclosure({ cases }: { cases: ChangeCases | null }) {
  if (!cases) return <Pending title="When the plan changes" />;
  return (
    <Disclosure icon={CheckCircle} title="When the plan changes" fact={`${cases.passed} of ${cases.total} pass`}>
      <ul className="flex flex-col">
        {cases.results.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 py-1.5">
            {entry.pass ? <CheckCircle weight="fill" className="size-4 shrink-0" /> : <XCircle weight="fill" className="size-4 shrink-0 text-signal" />}
            <span className="type-small min-w-0 flex-1 truncate font-bold" title={entry.riderHears}>
              {entry.title}
            </span>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

export function SimulatedResidentsTag() {
  return <Tag>Simulated residents, not real riders</Tag>;
}
