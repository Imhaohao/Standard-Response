"use client";

import { useMemo } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { Anchor } from "@/components/map/layers";
import { MapStage } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { ZoomControls } from "@/components/map/zoom-controls";
import { LatLng } from "@/lib/geo";
import { createProjection, Point } from "@/lib/ink-map/data";

const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;

// The house, drawn as a house, the same mark the driver page uses for a pickup.
function HomePin({ at }: { at: Point }) {
  return (
    <Anchor point={at}>
      <circle r={22} fill="var(--map-ink)" fillOpacity={0.1} />
      <path d="M -13 1 L 0 -11 L 13 1 L 13 12 L -13 12 Z" fill="var(--map-ink)" stroke="var(--map-paper)" strokeWidth={3} strokeLinejoin="round" />
      <rect x={-3.5} y={3} width={7} height={9} fill="var(--map-paper)" />
    </Anchor>
  );
}

// Tap your home on the map of Altadena. Pinch or scroll to zoom in on your street first.
export function HomePicker({ value, onPick }: { value: LatLng | null; onPick: (at: LatLng) => void }) {
  const data = useInkMapData();
  const projection = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }), [data?.origin]);
  if (!data) return <div className="grid h-72 place-items-center bg-map-paper type-small text-ink-muted">Loading the map…</div>;
  return (
    <div className="relative h-72 overflow-hidden rounded-2xl bg-map-paper">
      <MapStage
        data={data}
        view={VIEW}
        onPick={(point) => onPick(projection.toLatLng(point))}
        interactive
        className="absolute inset-0"
        controls={<ZoomControls className="absolute right-2 bottom-2" />}
      >
        {value && <HomePin at={projection.toLocal(value)} />}
      </MapStage>
    </div>
  );
}
