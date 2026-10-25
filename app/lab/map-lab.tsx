"use client";

import { useState } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { MapStage } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { ScenarioScrubber } from "@/components/map/scenario-scrubber";
import { useHazard } from "@/lib/ink-map/hazard";

function closeupView() {
  if (typeof location === "undefined") return null;
  const at = new URLSearchParams(location.search).get("at");
  if (!at) return null;
  const [x, y] = at.split(",").map(Number);
  return { kind: "closeup" as const, center: [x, y] as [number, number], radius: 120 };
}

// A bench for the renderer and the flat view, with the fire scrubbed by hand.
export function MapLab() {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const [minutes, setMinutes] = useState(90);

  if (!data) return <p className="type-body grid h-[100dvh] place-items-center text-ink-muted">Loading the map of Altadena…</p>;
  const last = hazard?.field.fronts[hazard.field.fronts.length - 1]?.minutes ?? 0;

  return (
    <div className="flex h-[100dvh] w-full flex-col">
      <div className="flex items-center gap-4 border-b border-line bg-panel px-4 py-2 text-on-panel">
        <ScenarioScrubber minutes={minutes} last={last} onMinutes={setMinutes} label="Fire scenario" />
      </div>
      <div className="min-h-0 flex-1">
        <MapStage data={data} view={closeupView() ?? { kind: "overview", fit: TOWN_FRAME }} hazard={hazard} minutes={minutes} />
      </div>
    </div>
  );
}
