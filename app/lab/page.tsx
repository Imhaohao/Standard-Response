"use client";

import { useState } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { MapStage, SurfaceMode } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { useHazard } from "@/lib/ink-map/hazard";

// A bench for the renderer and the flat view, with the fire scrubbed by hand.
export default function Lab() {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const [mode, setMode] = useState<SurfaceMode>("ink");
  const [minutes, setMinutes] = useState(90);

  if (!data) return <p className="type-body p-8">Loading the map…</p>;
  const last = hazard?.field.fronts[hazard.field.fronts.length - 1]?.minutes ?? 0;

  return (
    <div className="flex h-[100dvh] w-full flex-col">
      <div className="flex items-center gap-4 border-b border-line px-4 py-2">
        <button className="type-small font-semibold" onClick={() => setMode(mode === "ink" ? "paper" : "ink")}>
          {mode === "ink" ? "Flat view" : "3D view"}
        </button>
        <input
          type="range"
          min={0}
          max={last || 1}
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
          className="max-w-md flex-1"
          aria-label="Minutes after the warning"
        />
        <span className="type-small tabular-nums text-ink-muted">{Math.round(minutes)} min after the warning</span>
      </div>
      <div className="min-h-0 flex-1">
        <MapStage
          data={data}
          mode={mode}
          view={{ kind: "overview", fit: TOWN_FRAME }}
          hazard={hazard}
          minutes={minutes}
          fronts={hazard?.field.fronts}
        />
      </div>
    </div>
  );
}
