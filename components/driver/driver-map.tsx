"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";
import { Van as VanIcon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { GeoAnchor, GeoLine } from "@/components/map/layers";
import { MapStage } from "@/components/map/map-stage";
import { ZoomControls } from "@/components/map/zoom-controls";
import { NeedMark, useBuildingHighlights } from "@/components/map/use-highlights";
import { LatLng } from "@/lib/geo";
import { createProjection, InkMapData } from "@/lib/ink-map/data";
import { useFireClock, useHazard } from "@/lib/ink-map/hazard";
import { Stop, stopPlace, Vehicle } from "./stops";

const PAPER = "var(--map-paper)";
const INK = "var(--map-ink)";
const SIGNAL = "var(--signal)";
const CLOSEUP_RADIUS = 120;

// The house, drawn as a house: most homes in the burn scar have no footprint left in the map data,
// so the marker has to say "a building, here" on its own. Run stops carry their number on a flag.
function PickupPin({ at, order, focused }: { at: LatLng; order?: number; focused: boolean }) {
  const fill = focused ? SIGNAL : INK;
  return (
    <GeoAnchor at={at}>
      {focused && <circle r={22} fill="none" stroke={SIGNAL} strokeWidth={2.5} className="animate-ring-out" />}
      {focused && <circle r={30} fill={SIGNAL} fillOpacity={0.1} />}
      <path d="M -15 1 L 0 -12 L 15 1 L 15 14 L -15 14 Z" fill={fill} stroke={PAPER} strokeWidth={3} strokeLinejoin="round" />
      <rect x={-4} y={3} width={8} height={11} fill={PAPER} />
      {order !== undefined && (
        <g transform="translate(0 -32)">
          <line x1={0} y1={8} x2={0} y2={20} stroke={INK} strokeWidth={2} />
          <circle r={11} fill={fill} stroke={PAPER} strokeWidth={2.5} />
          <text textAnchor="middle" y={4.5} fill={PAPER} fontSize={13} fontWeight={800}>
            {order}
          </text>
        </g>
      )}
    </GeoAnchor>
  );
}

// The driver's own van, as the same chip the dispatcher's map draws for a van on a run.
function VanMark({ vehicle }: { vehicle: Vehicle }) {
  const width = vehicle.label.length * 7.6 + 34;
  return (
    <GeoAnchor at={{ lat: vehicle.lat, lng: vehicle.lng }}>
      <g transform={`translate(${-width / 2} -13)`}>
        <rect width={width} height={26} rx={7} fill={INK} stroke={PAPER} strokeWidth={2.5} />
        <VanIcon x={7} y={4} size={18} weight="fill" color={PAPER} />
        <text x={29} y={17.5} fontSize={13} fontWeight={800} fill={PAPER}>
          {vehicle.label}
        </text>
      </g>
    </GeoAnchor>
  );
}

function VanRoute({ vehicleId }: { vehicleId: Vehicle["_id"] }) {
  const routes = useQuery(api.dispatch.routes);
  const route = routes?.find((candidate) => candidate.vehicleId === vehicleId);
  if (!route || route.remaining.length < 2) return null;
  return (
    <>
      <GeoLine route={route.remaining} stroke={PAPER} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <GeoLine route={route.remaining} stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  );
}

type ToLocal = (point: LatLng) => [number, number];

// The camera holds on the pickup in focus, or on the van when there is nowhere to go yet.
function useCloseup(toLocal: ToLocal | null, focus: Stop | null, vehicle: Vehicle | undefined) {
  const place = (focus && stopPlace(focus)) ?? (vehicle ? { lat: vehicle.lat, lng: vehicle.lng } : null);
  const center = place && toLocal ? toLocal(place) : null;
  const cx = center ? Math.round(center[0]) : null;
  const cy = center ? Math.round(center[1]) : null;
  return useMemo(
    () => (cx === null || cy === null ? null : { kind: "closeup" as const, center: [cx, cy] as [number, number], radius: CLOSEUP_RADIUS }),
    [cx, cy],
  );
}

function useStopHighlights(data: InkMapData | null, toLocal: ToLocal | null, focus: Stop | null, run: Stop[]) {
  const marks = useMemo<NeedMark[]>(() => {
    if (!toLocal) return [];
    return [focus, ...run].flatMap((stop) => {
      const place = stop ? stopPlace(stop) : null;
      return place ? [{ point: toLocal(place), level: stop === focus ? 1 : 0.7, pulse: stop === focus }] : [];
    });
  }, [toLocal, focus, run]);
  return useBuildingHighlights(data, marks);
}

function StopPins({ focus, run }: { focus: Stop | null; run: Stop[] }) {
  const focusPlace = focus ? stopPlace(focus) : null;
  const focusOrder = focus && run.includes(focus) ? run.indexOf(focus) + 1 : undefined;
  return (
    <>
      {run.map((stop, index) => {
        const place = stopPlace(stop);
        return place && stop !== focus ? <PickupPin key={stop._id} at={place} order={index + 1} focused={false} /> : null;
      })}
      {focusPlace && <PickupPin at={focusPlace} focused order={focusOrder} />}
    </>
  );
}

// A close-up of the house the driver is going to, fixed on that house. The roof is red so the driver
// can find the right door before reading a word.
export function DriverMap({ focus, run, vehicle }: { focus: Stop | null; run: Stop[]; vehicle: Vehicle | undefined }) {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const control = useQuery(api.control.get);
  const clock = useFireClock(hazard, control?.warningIssuedAt);
  const toLocal = useMemo(() => (data ? createProjection(data.origin).toLocal : null), [data]);
  const view = useCloseup(toLocal, focus, vehicle);
  const highlights = useStopHighlights(data, toLocal, focus, run);

  if (!data || !view) return <div className="size-full bg-map-paper" aria-hidden />;

  return (
    <MapStage data={data} view={view} hazard={hazard} minutes={clock.minutes} highlights={highlights} className="absolute inset-0" controls={<ZoomControls className="absolute right-3 bottom-3" />}>
      {vehicle && <VanRoute vehicleId={vehicle._id} />}
      {vehicle && <VanMark vehicle={vehicle} />}
      <StopPins focus={focus} run={run} />
    </MapStage>
  );
}
