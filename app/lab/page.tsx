"use client";

import { InkMapCanvas, useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { useEffect, useState } from "react";
import type { InkMapHandle } from "@/components/ink-map/ink-map-canvas";
import { buildFireField, scenarioFronts, ScenarioGeoJson } from "@/lib/ink-map/fire-field";
import { createProjection } from "@/lib/ink-map/data";

export default function Lab() {
  const data = useInkMapData();
  const [handle, setHandle] = useState<InkMapHandle | null>(null);
  useEffect(() => {
    if (!handle) return;
    void fetch("/api/scenario").then((r) => r.json() as Promise<ScenarioGeoJson>).then((geojson) => {
      const fronts = scenarioFronts(geojson, createProjection(handle.data.origin).toLocal);
      handle.renderer.setFire(buildFireField(fronts));
      const minutes = Number(new URLSearchParams(location.search).get("m") ?? 60);
      handle.renderer.setFireMinutes(minutes);
      handle.renderer.setDebug(Number(new URLSearchParams(location.search).get("debug") ?? 0));
      handle.renderer.start();
    });
  }, [handle]);
  if (!data) return <p className="p-8">Loading map…</p>;
  const closeup = new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("closeup");
  const view = closeup
    ? { kind: "closeup" as const, center: closeup.split(",").map(Number) as [number, number], radius: 70 }
    : { kind: "overview" as const, fit: { x0: -1400, y0: -1300, x1: 2500, y1: 1900 } };
  return (
    <div className="h-[100dvh] w-full">
      <InkMapCanvas data={data} view={view} onReady={setHandle} />
    </div>
  );
}
