"use client";

import { ArrowUp, Wind } from "@phosphor-icons/react";
import { MapShape } from "@/components/map/layers";
import { DangerZones, zonesAt } from "@/lib/ink-map/danger";
import { ChromeSurface } from "./map-chrome";

const HAZARD = "var(--signal)";

// Bands nest (90% inside 50% inside 10%), so equal fills stack into a darker core.
const BAND_FILL_OPACITY = 0.13;
const BAND_EDGE: Record<number, { dash?: string; width: number; opacity: number }> = {
  0.1: { dash: "5 4", width: 1.2, opacity: 0.7 },
  0.5: { width: 1, opacity: 0.45 },
  0.9: { width: 1.6, opacity: 0.85 },
};
const DEFAULT_EDGE = { width: 1, opacity: 0.5 };

export function DangerLayer({ danger, minutes }: { danger: DangerZones; minutes: number }) {
  return (
    <g>
      {zonesAt(danger, minutes).map((zone) => {
        const edge = BAND_EDGE[zone.probability] ?? DEFAULT_EDGE;
        return (
          <MapShape
            key={zone.probability}
            rings={zone.rings}
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

function BandKey({ probabilities }: { probabilities: number[] }) {
  return (
    <span className="inline-flex items-center gap-2" aria-hidden>
      {probabilities.map((probability, index) => (
        <span key={probability} className="type-small inline-flex items-center gap-1 tabular-nums">
          <span className="size-2.5 rounded-sm bg-signal" style={{ opacity: Math.min(1, BAND_FILL_OPACITY * 2.2 * (index + 1)) }} />
          {Math.round(probability * 100)}%
        </span>
      ))}
    </span>
  );
}

function describe(danger: DangerZones) {
  const source = danger.wind.source === "nws" ? "the National Weather Service wind forecast" : `the scenario's own wind (${danger.wind.note ?? "no live wind"})`;
  const built = new Date(danger.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `Shaded areas show the chance each spot has burned by the slider's minute, from ${danger.members} spread-model runs under ${source}. Built at ${built}. A model forecast, not an observation.`;
}

export function ForecastControl({ danger, shown, onToggle }: { danger: DangerZones; shown: boolean; onToggle: () => void }) {
  return (
    <ChromeSurface className="flex items-center gap-3 py-1.5 pr-3 pl-1.5">
      <button
        type="button"
        aria-pressed={shown}
        onClick={onToggle}
        title={describe(danger)}
        className={`type-small inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-semibold whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-on-panel ${
          shown ? "bg-on-panel text-panel" : "bg-panel-raised text-on-panel hover:bg-panel"
        }`}
      >
        <Wind weight="bold" className="size-4" />
        {shown ? "Hide fire forecast" : "Show fire forecast"}
      </button>
      <WindReading danger={danger} />
      <span className={`transition-opacity duration-150 ${shown ? "" : "opacity-40"}`}>
        <BandKey probabilities={danger.probabilities} />
      </span>
      <span className="sr-only">{describe(danger)}</span>
    </ChromeSurface>
  );
}
