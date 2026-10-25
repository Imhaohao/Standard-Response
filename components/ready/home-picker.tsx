"use client";

import { useMemo } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { Anchor } from "@/components/map/layers";
import { MapStage } from "@/components/map/map-stage";
import { ZoomControls } from "@/components/map/zoom-controls";
import { LatLng } from "@/lib/geo";
import { createProjection, InkMapData, Point } from "@/lib/ink-map/data";
import { homeFrame, namedStreets, residentialCentre } from "./home-frame";

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

// The map opens a few blocks wide on the street in the typed address, and moves only when the
// street it found changes, so typing the rest of the address doesn't redraw the town.
function useHomeView(data: InkMapData | null, address: string) {
  const streets = useMemo(() => (data ? namedStreets(data) : []), [data]);
  const fallback = useMemo<Point>(() => (data ? residentialCentre(data) : [0, 0]), [data]);
  const { frame, street } = homeFrame(streets, address, fallback);
  const { x0, y0, x1, y1 } = frame;
  const view = useMemo(() => ({ kind: "overview" as const, fit: { x0, y0, x1, y1 } }), [x0, y0, x1, y1]);
  return { view, street };
}

const pickerHint = (street: string | null) =>
  street ? `Showing ${street}. Drag the map if your house isn't in view.` : "Drag the map to your street, or type your address above to jump there.";

// Tap your home on the map of Altadena, starting at street scale so one house is big enough to hit.
export function HomePicker({ address, value, onPick }: { address: string; value: LatLng | null; onPick: (at: LatLng) => void }) {
  const data = useInkMapData();
  const projection = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }), [data?.origin]);
  const { view, street } = useHomeView(data, address);
  return (
    <div className="flex flex-col gap-1.5">
      {data ? (
        <div className="relative h-80 overflow-hidden rounded-2xl bg-map-paper">
          <MapStage
            data={data}
            view={view}
            onPick={(point) => onPick(projection.toLatLng(point))}
            interactive
            className="absolute inset-0"
            controls={<ZoomControls className="absolute right-2 bottom-2" resetLabel="Back to my street" />}
          >
            {value && <HomePin at={projection.toLocal(value)} />}
          </MapStage>
        </div>
      ) : (
        <div className="grid h-80 place-items-center rounded-2xl bg-map-paper type-small text-ink-muted">Loading the map…</div>
      )}
      <p className="type-small text-ink-muted" aria-live="polite">
        {pickerHint(street)}
      </p>
    </div>
  );
}
