"use client";

import { useState } from "react";
import { Panel, PanelEmpty } from "../ui/panel";
import { Figure, RangeRow, SourceLabel } from "./range";
import { DoorFairness, Simulator, Spread } from "./results";

const COMPARISONS = [
  { key: "dispatchOnly", label: "OR-Tools vs heuristic" },
  { key: "outreachOnly", label: "Our calls vs 911 alone" },
  { key: "combined", label: "Both together" },
] as const;

const signed = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value)}`;
const spreadReadout = (spread: Spread) => `${signed(spread.median)} (${signed(spread.p5)} to ${signed(spread.p95)})`;

// The primary metric is on-time pickups. Each row is the per-seed difference between two policies on
// the same fictional night, with the 5th to 95th percentile across seeds.
export function SimulatorPanel({ simulator }: { simulator: Simulator | null }) {
  if (!simulator) return <Panel title="Simulator"><PanelEmpty>Shows up when Track C writes data/sim-results.json.</PanelEmpty></Panel>;
  const combined = simulator.results.combined.difference.pickupsOnTime;
  return (
    <Panel title="Simulator" aside={<span className="type-small text-on-panel-muted">{simulator.seeds} paired seeds</span>}>
      <div className="flex flex-col gap-3 p-3">
        <Figure value={signed(combined.median)} unit="more riders picked up on time" note={`range ${signed(combined.p5)} to ${signed(combined.p95)}`} />
        <ul>
          {COMPARISONS.map(({ key, label }) => {
            const spread = simulator.results[key].difference.pickupsOnTime;
            return (
              <RangeRow
                key={key}
                label={label}
                value={spread.median}
                low={spread.p5}
                high={spread.p95}
                domain={[-15, 70]}
                zero={0}
                readout={spreadReadout(spread)}
                emphasis={key === "combined"}
              />
            );
          })}
        </ul>
        <details className="group">
          <summary className="type-small cursor-pointer font-semibold text-on-panel-muted hover:text-on-panel">Where we don&apos;t help</summary>
          <p className="type-small mt-2 text-on-panel-muted">
            {Array.isArray(simulator.whereWeDontHelp) ? simulator.whereWeDontHelp.join(" ") : simulator.whereWeDontHelp}
          </p>
        </details>
      </div>
      <SourceLabel>{simulator.label}</SourceLabel>
    </Panel>
  );
}

const POLICIES = [
  { key: "score", label: "Our order" },
  { key: "score_no_aging", label: "Ours, no aging" },
  { key: "nearest", label: "Nearest first" },
  { key: "random", label: "Random" },
] as const;

function ScenarioPicker({ scenarios, current, onPick }: { scenarios: string[]; current: string; onPick: (scenario: string) => void }) {
  return (
    <label className="type-small flex items-center gap-2 text-on-panel-muted">
      <span className="sr-only">Scenario</span>
      <select value={current} onChange={(event) => onPick(event.target.value)} className="max-w-[14rem] truncate bg-panel-raised px-2 py-1 font-semibold text-on-panel">
        {scenarios.map((scenario) => (
          <option key={scenario} value={scenario}>
            {scenario}
          </option>
        ))}
      </select>
    </label>
  );
}

// Who gets a knock before their deadline when nobody answered the phone.
export function DoorFairnessPanel({ fairness }: { fairness: DoorFairness | null }) {
  const scenarios = Object.keys(fairness?.results ?? {});
  const [picked, setPicked] = useState<string | null>(null);
  if (!fairness) return <Panel title="Door checks"><PanelEmpty>Shows up when Track D writes data/door-fairness.json.</PanelEmpty></Panel>;
  const scenario = picked ?? scenarios[0];
  const results = fairness.results[scenario];
  const headline = fairness.headlines.find((line) => line.startsWith(scenario));
  return (
    <Panel title="Door checks" aside={<ScenarioPicker scenarios={scenarios} current={scenario} onPick={setPicked} />}>
      <div className="flex flex-col gap-3 p-3">
        <h3 className="type-small font-bold">Truly needy homes checked before their deadline</h3>
        <ul>
          {POLICIES.filter(({ key }) => results[key]).map(({ key, label }) => {
            const spread = results[key].needyInTime;
            return (
              <RangeRow
                key={key}
                label={label}
                value={spread.mean}
                low={spread.p5}
                high={spread.p95}
                domain={[0, 100]}
                readout={`${Math.round(spread.mean)}% (${Math.round(spread.p5)}–${Math.round(spread.p95)})`}
                emphasis={key === "score"}
              />
            );
          })}
        </ul>
        {headline && <p className="type-small text-on-panel-muted">{headline}</p>}
      </div>
      <SourceLabel>{fairness.label}</SourceLabel>
    </Panel>
  );
}
