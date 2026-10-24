import { ReactNode } from "react";
import { RangeTrack, Tag } from "./range";
import { Results, percent } from "./results";
import { accuracyOf } from "./call-panels";
import { signed } from "./dispatch-panels";
import { CallbackSpread } from "./live-panels";

type AnswerTileProps = {
  figure: string;
  unit?: string;
  label: string;
  rangeText: string;
  track?: null | { value: number; low: number; high: number; domain: [number, number]; zero?: number };
  tag?: ReactNode;
};

function AnswerTile({ figure, unit, label, rangeText, track, tag }: AnswerTileProps) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-2xl bg-panel p-5 text-on-panel shadow-float" title={`Range ${rangeText}`}>
      <p className="flex items-baseline gap-1.5">
        <span className="type-figure text-6xl">{figure}</span>
        {unit && <span className="type-title text-on-panel-muted">{unit}</span>}
      </p>
      <h2 className="type-heading">{label}</h2>
      <div className="flex flex-col gap-1">
        {track && <RangeTrack {...track} large />}
        <span className="type-small text-on-panel-muted tabular-nums">{rangeText}</span>
      </div>
      <div className="mt-auto min-h-6">{tag}</div>
    </li>
  );
}

const EM_DASH = "—";
const asSeconds = (ms: number) => (ms / 1000).toFixed(1);

function accuracyTile(evaluation: Results["evaluation"]) {
  const rate = evaluation?.allFieldsCorrect;
  return (
    <AnswerTile
      figure={rate ? percent(accuracyOf(rate)) : EM_DASH}
      label="Every field right"
      rangeText={rate ? `${percent(rate.ci95[0])}–${percent(rate.ci95[1])}` : EM_DASH}
      track={rate && { value: accuracyOf(rate), low: rate.ci95[0], high: rate.ci95[1], domain: [0.8, 1] }}
      tag={evaluation && <Tag>Simulated residents, not real riders</Tag>}
    />
  );
}

function honestyTile(honesty: Results["honesty"]) {
  const rate = honesty?.model ?? honesty?.lexical;
  const value = rate?.rate ?? 0;
  return (
    <AnswerTile
      figure={rate ? percent(value, 1) : EM_DASH}
      label="Implied a driver was coming"
      rangeText={rate ? `${percent(rate.ci95[0], 1)}–${percent(rate.ci95[1], 1)}` : EM_DASH}
      track={rate && { value, low: rate.ci95[0], high: rate.ci95[1], domain: [0, 0.05] }}
      tag={honesty && !honesty.humanSpotCheck && <Tag>awaiting human labels</Tag>}
    />
  );
}

function callbackTile(spread: CallbackSpread | null) {
  return (
    <AnswerTile
      figure={spread ? asSeconds(spread.medianMs) : EM_DASH}
      unit={spread ? "s" : undefined}
      label="Median wait until rider told"
      rangeText={spread ? `${asSeconds(spread.minMs)}–${asSeconds(spread.maxMs)} s` : EM_DASH}
      track={spread && { value: spread.medianMs, low: spread.minMs, high: spread.maxMs, domain: [0, Math.max(spread.maxMs * 1.1, 1)] }}
    />
  );
}

function simulatorTile(simulator: Results["simulator"]) {
  const gain = simulator?.results.combined.difference.pickupsOnTime;
  return (
    <AnswerTile
      figure={gain ? signed(gain.median) : EM_DASH}
      label="More riders picked up on time"
      rangeText={gain ? `${signed(gain.p5)} to ${signed(gain.p95)}` : EM_DASH}
      track={gain && { value: gain.median, low: gain.p5, high: gain.p95, domain: [-15, 70], zero: 0 }}
      tag={simulator && <Tag>{simulator.label}</Tag>}
    />
  );
}

export function AnswerTiles({ results, callbackSpread }: { results: Results | null; callbackSpread: CallbackSpread | null }) {
  return (
    <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {accuracyTile(results?.evaluation ?? null)}
      {honestyTile(results?.honesty ?? null)}
      {callbackTile(callbackSpread)}
      {simulatorTile(results?.simulator ?? null)}
    </ul>
  );
}
