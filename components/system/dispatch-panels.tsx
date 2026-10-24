"use client";

import { useState } from "react";
import { DoorOpen, Truck } from "@phosphor-icons/react";
import { Disclosure } from "./disclosure";
import { RangeRow, Tag } from "./range";
import { DoorFairness, Simulator, Spread } from "./results";

const COMPARISONS = [
  { key: "dispatchOnly", label: "OR-Tools vs heuristic" },
  { key: "outreachOnly", label: "Our calls vs 911 alone" },
  { key: "combined", label: "Both together" },
] as const;

export const signed = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value)}`;
const spreadReadout = (spread: Spread) => `${signed(spread.median)} (${signed(spread.p5)} to ${signed(spread.p95)})`;

export function SimulatorDisclosure({ simulator }: { simulator: Simulator | null }) {
  if (!simulator) {
    return (
      <Disclosure icon={Truck} title="Simulator comparisons" fact="–">
        <p className="type-small text-on-panel-muted">No results file yet.</p>
      </Disclosure>
    );
  }
  const whereWeDontHelp = Array.isArray(simulator.whereWeDontHelp) ? simulator.whereWeDontHelp.join(" ") : simulator.whereWeDontHelp;
  return (
    <Disclosure icon={Truck} title="Simulator comparisons" fact={`on-time pickups, ${simulator.seeds} paired seeds`}>
      <Tag>{simulator.label}</Tag>
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
      {whereWeDontHelp && (
        <details>
          <summary className="type-small cursor-pointer font-semibold text-on-panel-muted hover:text-on-panel">Where we don&apos;t help</summary>
          <p className="type-small mt-2 text-on-panel-muted">{whereWeDontHelp}</p>
        </details>
      )}
    </Disclosure>
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
      <select value={current} onChange={(event) => onPick(event.target.value)} className="min-w-0 max-w-full truncate bg-panel-raised px-2 py-1 font-semibold text-on-panel">
        {scenarios.map((scenario) => (
          <option key={scenario} value={scenario}>
            {scenario}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DoorFairnessDisclosure({ fairness }: { fairness: DoorFairness | null }) {
  const scenarios = Object.keys(fairness?.results ?? {});
  const [picked, setPicked] = useState<string | null>(null);
  if (!fairness) {
    return (
      <Disclosure icon={DoorOpen} title="Door checks" fact="–">
        <p className="type-small text-on-panel-muted">No results file yet.</p>
      </Disclosure>
    );
  }
  const scenario = picked ?? scenarios[0];
  const results = fairness.results[scenario];
  const ourShare = results.score?.needyInTime.mean;
  return (
    <Disclosure icon={DoorOpen} title="Door checks" fact={ourShare === undefined ? "–" : `${Math.round(ourShare)}% of needy homes checked in time`}>
      <Tag>Simulated; a policy test, not a forecast</Tag>
      <ScenarioPicker scenarios={scenarios} current={scenario} onPick={setPicked} />
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
    </Disclosure>
  );
}
