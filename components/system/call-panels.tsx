"use client";

import { useQuery } from "convex/react";
import { CheckCircle, XCircle } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Panel, PanelEmpty } from "../ui/panel";
import { Figure, RangeRow, SourceLabel } from "./range";
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

const accuracyOf = (rate: Rate) => rate.accuracy ?? rate.rate ?? 0;
const rangeReadout = (rate: Rate) => `${percent(accuracyOf(rate))} (${percent(rate.ci95[0])}–${percent(rate.ci95[1])})`;

function AccuracyRow({ label, rate, emphasis = false }: { label: string; rate: Rate; emphasis?: boolean }) {
  return <RangeRow label={label} value={accuracyOf(rate)} low={rate.ci95[0]} high={rate.ci95[1]} domain={[0.8, 1]} readout={rangeReadout(rate)} emphasis={emphasis} />;
}

export function CallAccuracy({ evaluation }: { evaluation: Evaluation | null }) {
  if (!evaluation) return <Panel title="Call accuracy"><PanelEmpty>Shows up when Track D writes data/eval-results.json.</PanelEmpty></Panel>;
  const { fields, allFieldsCorrect, corrections } = evaluation;
  return (
    <Panel title="Call accuracy" aside={<span className="type-small text-on-panel-muted">{evaluation.completed} of {evaluation.personas} personas</span>}>
      <div className="flex flex-col gap-3 p-3">
        {evaluation.caveat && <p className="type-heading bg-panel-raised px-3 py-2">{evaluation.caveat}</p>}
        <Figure value={percent(accuracyOf(allFieldsCorrect), 1)} unit="of calls got every field right" note={`95% range ${percent(allFieldsCorrect.ci95[0])}–${percent(allFieldsCorrect.ci95[1])}`} />
        <ul>
          {PLAN_FIELDS.filter(({ key }) => fields[key]).map(({ key, label }, index) => (
            <AccuracyRow key={key} label={label} rate={fields[key]} emphasis={index < 4} />
          ))}
        </ul>
        <div>
          <h3 className="type-small font-bold">Corrections caught, {corrections.correct} of {corrections.total}</h3>
          <ul>
            {Object.entries(corrections.byWhen).map(([when, rate]) => (
              <AccuracyRow key={when} label={CORRECTION_LABELS[when] ?? when} rate={rate} />
            ))}
          </ul>
        </div>
      </div>
      <SourceLabel>{evaluation.label}</SourceLabel>
    </Panel>
  );
}

const STATUS_LABELS: Record<string, string> = { none: "No request yet", received: "Waiting for a driver", reassigning: "Finding a new driver", approved: "Offer sent" };

export function HonestyPanel({ honesty }: { honesty: Honesty | null }) {
  if (!honesty) return <Panel title="Honesty"><PanelEmpty>Shows up when Track D writes data/honesty-results.json.</PanelEmpty></Panel>;
  const headline = honesty.model ?? honesty.lexical;
  return (
    <Panel title="Honesty" aside={<span className="type-small text-on-panel-muted">{honesty.linesGraded.toLocaleString()} agent lines</span>}>
      <div className="flex flex-col gap-3 p-3">
        <Figure
          value={percent(headline.rate ?? 0, 2)}
          unit={honesty.model ? "implied a driver was coming" : "implied a driver was coming, lexical only"}
          note={`95% range ${percent(headline.ci95[0], 1)}–${percent(headline.ci95[1], 1)}`}
        />
        <p className="type-small text-on-panel-muted">
          Keyword check: {percent(honesty.lexical.rate ?? 0, 2)} of {honesty.lexical.graded} lines
        </p>
        <ul>
          {Object.entries(honesty.byStatus).map(([status, rate]) =>
            rate ? (
              <RangeRow
                key={status}
                label={STATUS_LABELS[status] ?? status}
                value={rate.rate ?? 0}
                low={rate.ci95[0]}
                high={rate.ci95[1]}
                domain={[0, 0.05]}
                readout={`${percent(rate.rate ?? 0, 1)} of ${rate.graded}`}
              />
            ) : null,
          )}
        </ul>
      </div>
      <SourceLabel>{honesty.label}</SourceLabel>
    </Panel>
  );
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// From the first agent audio after the resident stops talking, on real calls only.
export function LatencyPanel({ evaluation }: { evaluation: Evaluation | null }) {
  const lines = useQuery(api.estimates.agentLines, { limit: 1000 });
  const latencies = (lines ?? []).flatMap((line) => (line.latencyMs === null ? [] : [line.latencyMs])).sort((a, b) => a - b);
  const live = latencies.length > 0;
  return (
    <Panel title="Turn latency" aside={<span className="type-small text-on-panel-muted">{live ? `${latencies.length} live turns` : "Text eval"}</span>}>
      <dl className="grid grid-cols-2 gap-px bg-panel-raised">
        {[
          { label: "Median", value: live ? quantile(latencies, 0.5) : evaluation?.latency.turnMsP50 },
          { label: "95th percentile", value: live ? quantile(latencies, 0.95) : evaluation?.latency.turnMsP95 },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1 bg-panel p-3">
            <dt className="type-small text-on-panel-muted">{label}</dt>
            <dd className="flex items-baseline gap-1">
              <span className="type-figure text-3xl">{value === undefined ? "–" : Math.round(value).toLocaleString()}</span>
              <span className="type-small text-on-panel-muted">ms</span>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function ChangeCasesPanel({ cases }: { cases: ChangeCases | null }) {
  if (!cases) return <Panel title="Change cases"><PanelEmpty>Shows up when Track B writes data/redteam-change-cases.json.</PanelEmpty></Panel>;
  return (
    <Panel title="When the plan changes" aside={<span className="type-small font-bold tabular-nums">{cases.passed} of {cases.total} pass</span>}>
      <ul className="flex flex-col">
        {cases.results.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-1 border-b border-panel-raised px-3 py-2.5">
            <span className="type-small flex items-center gap-2 font-bold">
              {entry.pass ? <CheckCircle weight="fill" className="size-4 shrink-0" /> : <XCircle weight="fill" className="size-4 shrink-0 text-signal" />}
              {entry.title}
            </span>
            <q className="type-small pl-6 text-on-panel-muted">{entry.riderHears}</q>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
