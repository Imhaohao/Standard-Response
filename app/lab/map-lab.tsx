"use client";

import { useState } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { MapViewControl } from "@/components/map/map-bar";
import { MapStage, SurfaceMode } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { scenarioClock } from "@/components/rescue/map-chrome";
import { useHazard } from "@/lib/ink-map/hazard";

function closeupView() {
  if (typeof location === "undefined") return null;
  const at = new URLSearchParams(location.search).get("at");
  if (!at) return null;
  const [x, y] = at.split(",").map(Number);
  return { kind: "closeup" as const, center: [x, y] as [number, number], radius: 120 };
}

// The rescue map's fire progress bar, made draggable: a signal-red fill up to a round knob on a hairline track.
const SCRUBBER = [
  "h-6 min-w-0 max-w-md flex-1 cursor-pointer appearance-none bg-transparent focus-visible:outline-none",
  "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full",
  "[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-signal)_var(--filled),var(--color-line)_var(--filled))]",
  "[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
  "[&::-webkit-slider-thumb]:bg-signal [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--color-panel)]",
  "focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--color-panel),0_0_0_4px_var(--color-on-panel)]",
  "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-line",
  "[&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-signal",
  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-signal",
  "[&::-moz-range-thumb]:shadow-[0_0_0_2px_var(--color-panel)]",
  "focus-visible:[&::-moz-range-thumb]:shadow-[0_0_0_2px_var(--color-panel),0_0_0_4px_var(--color-on-panel)]",
].join(" ");

function FireScrubber({ minutes, last, onMinutes }: { minutes: number; last: number; onMinutes: (minutes: number) => void }) {
  const max = last || 1;
  const filled = `${Math.min(100, (minutes / max) * 100)}%`;
  return (
    <>
      <input
        type="range"
        min={0}
        max={max}
        value={minutes}
        onChange={(event) => onMinutes(Number(event.target.value))}
        className={SCRUBBER}
        style={{ "--filled": filled } as React.CSSProperties}
        aria-label="Fire scenario"
        aria-valuetext={`${scenarioClock(minutes)} after the warning`}
      />
      <span className="type-small w-16 shrink-0 font-semibold tabular-nums" title="After the warning">
        {scenarioClock(minutes)}
      </span>
    </>
  );
}

// A bench for the renderer and the flat view, with the fire scrubbed by hand.
export function MapLab() {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const [mode, setMode] = useState<SurfaceMode>("ink");
  const [minutes, setMinutes] = useState(90);

  if (!data) return <p className="type-body grid h-[100dvh] place-items-center text-ink-muted">Loading the map of Altadena…</p>;
  const last = hazard?.field.fronts[hazard.field.fronts.length - 1]?.minutes ?? 0;

  return (
    <div className="flex h-[100dvh] w-full flex-col">
      <div className="flex items-center gap-4 border-b border-line bg-panel px-4 py-2 text-on-panel">
        <MapViewControl mode={mode} onMode={setMode} />
        <FireScrubber minutes={minutes} last={last} onMinutes={setMinutes} />
      </div>
      <div className="min-h-0 flex-1">
        <MapStage data={data} mode={mode} view={closeupView() ?? { kind: "overview", fit: TOWN_FRAME }} hazard={hazard} minutes={minutes} />
      </div>
    </div>
  );
}
