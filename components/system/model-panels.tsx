"use client";

import { useState } from "react";
import { Brain, Car, Sliders } from "@phosphor-icons/react";
import { SegmentedControl } from "../ui/segmented-control";
import { Tag } from "../ui/tag";
import { signed } from "./dispatch-panels";
import { Disclosure, PendingDisclosure } from "./disclosure";
import { RangeRow } from "./range";
import { ExplorationScenario, MeanSpread, NeedModel, NeedScores, SensitivityRow, Simulator, Spread } from "./results";

type Factor = "fleetSize" | "answerRate" | "hazardSpeed" | "call911Lead";
type Comparison = "combined" | "dispatchOnly";

const FACTORS: readonly { value: Factor; label: string; level: (value: number) => string }[] = [
  { value: "fleetSize", label: "Fleet", level: (value) => `${value} vehicles` },
  { value: "answerRate", label: "Answer rate", level: (value) => `${value}× answers` },
  { value: "hazardSpeed", label: "Fire speed", level: (value) => `${value}× arrival` },
  { value: "call911Lead", label: "911 lead", level: (value) => `${value}× lead` },
];

const COMPARISONS: readonly { value: Comparison; label: string }[] = [
  { value: "combined", label: "Both together" },
  { value: "dispatchOnly", label: "OR-Tools vs heuristic" },
];

const spreadReadout = (spread: Spread) => `${signed(spread.median)} (${signed(spread.p5)} to ${signed(spread.p95)})`;

// The track always includes zero, so "no difference" sits at the same tick for every factor.
function domainOf(spreads: Spread[]): [number, number] {
  const low = Math.min(0, ...spreads.map((spread) => spread.p5));
  const high = Math.max(0, ...spreads.map((spread) => spread.p95));
  return [low - 2, high + 2];
}

function SensitivityRows({ rows, factor, comparison }: { rows: SensitivityRow[]; factor: (typeof FACTORS)[number]; comparison: Comparison }) {
  const spreads = rows.map((row) => row[comparison].pickupsOnTimeDifference);
  const domain = domainOf(spreads);
  return (
    <ul>
      {rows.map((row, index) => (
        <RangeRow
          key={row.level}
          label={factor.level(row.level)}
          value={spreads[index].median}
          low={spreads[index].p5}
          high={spreads[index].p95}
          domain={domain}
          zero={0}
          readout={spreadReadout(spreads[index])}
        />
      ))}
    </ul>
  );
}

// The same comparisons rerun with one input changed at a time, so a judge can see where the gain holds and where it vanishes.
export function SensitivityDisclosure({ simulator }: { simulator: Simulator | null }) {
  const [factorKey, setFactor] = useState<Factor>("fleetSize");
  const [comparison, setComparison] = useState<Comparison>("combined");
  const sensitivity = simulator?.sensitivity;
  if (!sensitivity?.length) return <PendingDisclosure icon={Sliders} title="What if" />;
  const factor = FACTORS.find((candidate) => candidate.value === factorKey) ?? FACTORS[0];
  const rows = sensitivity.filter((row) => row.factor === factor.value).sort((a, b) => a.level - b.level);
  return (
    <Disclosure icon={Sliders} title="What if" fact={`${sensitivity.length} settings, ${simulator?.sensitivitySeeds ?? "–"} seeds each`}>
      <Tag>Simulated; a policy test, not a forecast</Tag>
      <div className="flex flex-wrap gap-2">
        <SegmentedControl options={FACTORS} value={factor.value} onChange={setFactor} ariaLabel="Input to change" />
        <SegmentedControl options={COMPARISONS} value={comparison} onChange={setComparison} ariaLabel="Comparison" />
      </div>
      <p className="type-small text-on-panel-muted">{rows[0]?.factorLabel}. Extra riders picked up on time, median with 5th to 95th percentile.</p>
      <SensitivityRows rows={rows} factor={factor} comparison={comparison} />
    </Disclosure>
  );
}

const SCENARIOS: { key: ExplorationScenario; label: string }[] = [
  { key: "ownPace", label: "Own pace" },
  { key: "withCalls", label: "With our calls" },
  { key: "everyoneAtOnce", label: "All at once" },
];

const minutes = (spread: Spread) => `${Math.round(spread.median)} min (${Math.round(spread.p5)}–${Math.round(spread.p95)})`;
const times = (spread: Spread) => `${spread.median.toFixed(1)}× (${spread.p5.toFixed(1)}–${spread.p95.toFixed(1)})`;

function ScenarioRows({ metric, scenarios, readout, zero }: { metric: string; scenarios: Record<ExplorationScenario, Record<string, Spread>>; readout: (spread: Spread) => string; zero?: number }) {
  const spreads = SCENARIOS.map(({ key }) => scenarios[key][metric]);
  const high = Math.max(...spreads.map((spread) => spread.p95)) * 1.1;
  return (
    <ul>
      {SCENARIOS.map(({ key, label }, index) => (
        <RangeRow
          key={key}
          label={label}
          value={spreads[index].median}
          low={spreads[index].p5}
          high={spreads[index].p95}
          domain={[0, high]}
          zero={zero}
          readout={readout(spreads[index])}
          emphasis={key === "everyoneAtOnce"}
        />
      ))}
    </ul>
  );
}

// Track C's congestion model: what the roads do when the whole area drives out. Every input is an assumption.
export function ExplorationDisclosure({ simulator }: { simulator: Simulator | null }) {
  const exploration = simulator?.exploration;
  if (!exploration) return <PendingDisclosure icon={Car} title="Everyone leaves at once" />;
  const { scenarios } = exploration;
  const emptyRoads = scenarios.everyoneAtOnce.freeFlowMeanTripMinutes.median;
  return (
    <Disclosure icon={Car} title="Everyone leaves at once" fact={`trips ${Math.round(scenarios.everyoneAtOnce.meanTripMinutes.median)} min, ${Math.round(emptyRoads)} on empty roads`}>
      <Tag>{exploration.label}</Tag>
      <p className="type-small text-on-panel-muted">Mean drive to the shelter. The tick is the same drive on empty roads.</p>
      <ScenarioRows metric="meanTripMinutes" scenarios={scenarios} readout={minutes} zero={emptyRoads} />
      <p className="type-small text-on-panel-muted">Busiest road segment, as a multiple of its capacity</p>
      <ScenarioRows metric="worstVolumeToCapacity" scenarios={scenarios} readout={times} />
      <dl className="type-small grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-on-panel-muted">
        {SCENARIOS.map(({ key, label }) => (
          <div key={key} className="contents">
            <dt className="font-semibold text-on-panel">{label}</dt>
            <dd>{exploration.scenarioMeaning[key]}</dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

const NEED_VARIANTS: { label: string; pick: (model: NeedModel) => NeedScores }[] = [
  { label: "Census alone", pick: (model) => model.censusPriorOnly },
  { label: "Neighbor smoothing", pick: (model) => model.chosen },
  { label: "Plus nominations", pick: (model) => model.withNominations },
];

function NeedRows({ model, score, domain }: { model: NeedModel; score: keyof NeedScores; domain: [number, number] }) {
  return (
    <ul>
      {NEED_VARIANTS.map(({ label, pick }, index) => {
        const spread: MeanSpread = pick(model)[score];
        return (
          <RangeRow
            key={label}
            label={label}
            value={spread.mean}
            low={spread.p5}
            high={spread.p95}
            domain={domain}
            readout={`${spread.mean.toFixed(2)} (${spread.p5.toFixed(2)}–${spread.p95.toFixed(2)})`}
            emphasis={index === NEED_VARIANTS.length - 1}
          />
        );
      })}
    </ul>
  );
}

// Track D's need model: how well it ranks the homes nobody answered at, against their true need.
export function NeedModelDisclosure({ model }: { model: NeedModel | null }) {
  if (!model) return <PendingDisclosure icon={Brain} title="Need model" />;
  return (
    <Disclosure icon={Brain} title="Need model" fact={`ranks unreached homes at AUC ${model.withNominations.auc.mean.toFixed(2)}`}>
      <Tag>Synthetic households; a test of the method</Tag>
      <p className="type-small text-on-panel-muted">AUC: the chance a needy home ranks above one that isn&apos;t (0.5 is a coin flip)</p>
      <NeedRows model={model} score="auc" domain={[0.5, 0.75]} />
      <p className="type-small text-on-panel-muted">Share of the top tenth that truly need help</p>
      <NeedRows model={model} score="top10Precision" domain={[0, 0.5]} />
      <details>
        <summary className="type-small cursor-pointer font-semibold text-on-panel-muted hover:text-on-panel">How to read this</summary>
        <p className="type-small mt-2 text-on-panel-muted">{model.readingTheResult}</p>
      </details>
    </Disclosure>
  );
}
