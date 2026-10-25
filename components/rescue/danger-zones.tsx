"use client";

import { ArrowUp } from "@phosphor-icons/react";
import { MapShape } from "@/components/map/layers";
import { useMemo } from "react";
import { DangerZones, ForecastField, forecastBandGrid } from "@/lib/ink-map/danger";
import { isolines } from "@/lib/ink-map/isolines";
import { Switch } from "@/components/ui/switch";

const HAZARD = "var(--signal)";

// Bands nest (90% inside 50% inside 10%), so equal fills stack into a darker core.
const BAND_FILL_OPACITY = 0.13;
const BAND_EDGE: Record<number, { dash?: string; width: number; opacity: number }> = {
  0.1: { dash: "5 4", width: 1.2, opacity: 0.7 },
  0.5: { width: 1, opacity: 0.45 },
  0.9: { width: 1.6, opacity: 0.85 },
};
const DEFAULT_EDGE = { width: 1, opacity: 0.5 };

// The flat map's forecast, traced from the same smooth arrival field the 3D map shades, so the bands
// slide with the clock instead of jumping every ten minutes.
export function DangerLayer({ danger, field, minutes }: { danger: DangerZones; field: ForecastField; minutes: number }) {
  const probabilities = useMemo(() => [...danger.probabilities].sort((a, b) => a - b).slice(0, 3), [danger]);
  const grids = useMemo(() => probabilities.map((probability, band) => ({ probability, grid: forecastBandGrid(field, band) })), [probabilities, field]);
  const bands = useMemo(() => grids.map(({ probability, grid }) => ({ probability, rings: isolines(grid, minutes) })), [grids, minutes]);
  return (
    <g>
      {bands.map(({ probability, rings }) => {
        const edge = BAND_EDGE[probability] ?? DEFAULT_EDGE;
        return (
          <MapShape
            key={probability}
            rings={rings}
            fill={HAZARD}
            fillOpacity={BAND_FILL_OPACITY}
            stroke={HAZARD}
            strokeOpacity={edge.opacity}
            strokeWidth={edge.width}
            strokeDasharray={edge.dash}
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (degrees: number) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

function WindReading({ danger }: { danger: DangerZones }) {
  const now = danger.wind.now;
  if (danger.wind.source !== "nws" || !now) {
    return <span className="type-small font-semibold text-on-panel-muted">Scenario wind</span>;
  }
  return (
    <span className="type-small inline-flex shrink-0 items-center gap-1 font-semibold whitespace-nowrap tabular-nums">
      <ArrowUp weight="bold" className="size-3.5" style={{ rotate: `${now.fromDegrees + 180}deg` }} aria-hidden />
      {Math.round(now.speedKmh)} km/h from {compass(now.fromDegrees)}
    </span>
  );
}

// The map lays one translucent fill per band, so the likeliest ground is where all three stack.
const stackedOpacity = (layers: number) => Math.min(1, BAND_FILL_OPACITY * 2.2 * layers);

function BandKey({ probabilities }: { probabilities: number[] }) {
  const ordered = [...probabilities].sort((a, b) => a - b);
  const percent = (probability: number) => Math.round(probability * 100);
  return (
    <span className="type-small inline-flex items-center gap-2 text-on-panel-muted">
      <span className="flex h-2.5 w-14 shrink-0 overflow-hidden rounded-full" aria-hidden>
        {ordered.map((probability, index) => (
          <span key={probability} className="flex-1 bg-signal" style={{ opacity: stackedOpacity(index + 1) }} />
        ))}
      </span>
      {percent(ordered[0])}–{percent(ordered[ordered.length - 1])}% chance of fire within the hour
    </span>
  );
}

function describe(danger: DangerZones) {
  const source = danger.wind.source === "nws" ? "the National Weather Service wind forecast" : `the scenario's own wind (${danger.wind.note ?? "no live wind"})`;
  const built = new Date(danger.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `Shaded areas show the chance each spot has burned an hour from now, from ${danger.members} spread-model runs under ${source}. Built at ${built}.`;
}

export function ForecastControl({ danger, shown, onToggle }: { danger: DangerZones; shown: boolean; onToggle: () => void }) {
  return (
    <>
      <span title={describe(danger)}>
        <Switch checked={shown} onChange={onToggle} label="Fire forecast" className="-ml-1 rounded-lg px-1 py-0.5 hover:bg-panel-raised" />
      </span>
      {shown && <BandKey probabilities={danger.probabilities} />}
      {shown && <WindReading danger={danger} />}
    </>
  );
}
