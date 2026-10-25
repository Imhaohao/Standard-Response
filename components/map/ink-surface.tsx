"use client";

import { useCallback, useEffect, useState } from "react";
import { InkMapCanvas, InkMapHandle } from "@/components/ink-map/ink-map-canvas";
import { InkMapView } from "@/lib/ink-map/camera";
import { InkMapData } from "@/lib/ink-map/data";
import { Hazard } from "@/lib/ink-map/hazard";
import { BuildingState } from "@/lib/ink-map/renderer";
import type { StageForecast } from "./map-stage";

// The WebGL half of the map. Everything it needs arrives as props; the parent keeps the handle
// so it can project markers into the same frame.
export function InkSurface({
  data,
  view,
  hazard,
  minutes,
  forecast,
  highlights,
  onHandle,
  onFail,
}: {
  data: InkMapData;
  view: InkMapView;
  hazard: Hazard | null;
  minutes: number;
  forecast?: StageForecast | null;
  highlights: Map<number, BuildingState>;
  onHandle: (handle: InkMapHandle | null) => void;
  onFail: () => void;
}) {
  const [handle, setHandle] = useState<InkMapHandle | null>(null);

  // InkMapCanvas reports a new handle on every resize. Keep one per renderer so the effects
  // below do not rebuild the fire texture while a window is being dragged.
  const accept = useCallback(
    (next: InkMapHandle | null) => {
      setHandle((current) => (current && next && current.renderer === next.renderer ? current : next));
      onHandle(next);
    },
    [onHandle],
  );

  useEffect(() => {
    if (!handle) return;
    handle.renderer.setFire(hazard?.field ?? null, hazard?.burns !== false);
    handle.renderer.setBuildingStates(highlights);
    if (hazard || highlights.size > 0) handle.renderer.start();
    else handle.renderer.stop();
    return () => handle.renderer.stop();
  }, [handle, hazard, highlights]);

  useEffect(() => {
    handle?.renderer.setFireMinutes(minutes);
  }, [handle, minutes]);

  useEffect(() => {
    handle?.renderer.setForecast(forecast?.field ?? null, forecast?.aheadMinutes ?? 0);
  }, [handle, forecast]);

  return <InkMapCanvas data={data} view={view} onReady={accept} onFail={onFail} />;
}
