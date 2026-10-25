"use client";

import { Van as VanIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { GeoAnchor, GeoLine } from "@/components/map/layers";
import { buildPlaceIndex, buildingForPoint } from "@/lib/ink-map/place";
import { BuildingState } from "@/lib/ink-map/renderer";
import { createProjection, InkMapData } from "@/lib/ink-map/data";
import { countAt, decodeReplay, Replay, ReplayCount, ReplayFile, riskStates, RiskState, vanAt } from "@/lib/replay/replay";

const INK = "var(--map-ink)";
const PAPER = "var(--map-paper)";

export function useReplay(city: string | null): Replay | null {
  const [replay, setReplay] = useState<{ city: string; replay: Replay } | null>(null);
  useEffect(() => {
    if (!city) return;
    let live = true;
    fetch(`/scenarios/${city}-replay.json`)
      .then((response) => (response.ok ? (response.json() as Promise<ReplayFile>) : null))
      .then((file) => live && file && setReplay({ city, replay: decodeReplay(file) }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [city]);
  return replay && replay.city === city ? replay.replay : null;
}

// The roof is the mark. Red is a household in the hazard's path that asked for a ride and is still waiting; it
// pulses until a van has it. A home the hazard reached first goes dark with a trace of red, so it reads as lost, not
// as still waiting. Everything else keeps its ordinary ink roof.
const ROOF: Record<RiskState, BuildingState | null> = {
  waiting: { level: 0.95, pulse: true },
  vanComing: { level: 0.7, pulse: false },
  missed: { level: 0.2, pulse: false, occupancy: "stillHome" },
  out: null,
};

function useHomeBuildings(replay: Replay | null, data: InkMapData | null) {
  return useMemo(() => {
    if (!replay || !data) return [];
    const index = buildPlaceIndex(data);
    const { toLocal } = createProjection(data.origin);
    return replay.homes.map((home) => buildingForPoint(index, data, toLocal(home)));
  }, [replay, data]);
}

// Roofs for MapStage's `highlights`, recomputed once a scene minute: the renderer repaints every building it is
// handed, so a per-frame map would cost far more than the minute it shows.
export function useReplayHighlights(replay: Replay | null, data: InkMapData | null, minute: number) {
  const buildings = useHomeBuildings(replay, data);
  const wholeMinute = Math.floor(minute);
  return useMemo(() => {
    const roofs = new Map<number, BuildingState>();
    if (!replay) return roofs;
    for (const [home, state] of riskStates(replay, wholeMinute * 60)) {
      const building = buildings[home];
      const roof = ROOF[state];
      if (building === null || building === undefined || !roof) continue;
      const held = roofs.get(building);
      if (!held || roof.level > held.level) roofs.set(building, roof);
    }
    return roofs;
  }, [replay, buildings, wholeMinute]);
}

function VanDot({ replay, vehicle, seconds }: { replay: Replay; vehicle: number; seconds: number }) {
  const van = vanAt(replay, vehicle, seconds);
  return (
    <>
      {van.driving && <GeoLine route={van.ahead} fill="none" stroke={INK} strokeOpacity={0.45} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}
      <GeoAnchor at={van.at}>
        <circle r={9} fill={INK} stroke={PAPER} strokeWidth={2} />
        <VanIcon x={-6} y={-6} size={12} weight="fill" color="white" />
      </GeoAnchor>
    </>
  );
}

// Drawn inside MapStage. Households are told by their roofs alone; the vans, on their streets, are the only marks.
export function ReplayOverlay({ replay, minute }: { replay: Replay; minute: number }) {
  const seconds = minute * 60;
  return <g>{replay.file.vehicles.map((_, vehicle) => <VanDot key={vehicle} replay={replay} vehicle={vehicle} seconds={seconds} />)}</g>;
}

export const replayLastMinute = (replay: Replay | null) => (replay ? Math.ceil(replay.file.endS / 60) : 0);

export function useReplayCount(replay: Replay | null, minute: number): ReplayCount | null {
  const wholeMinute = Math.floor(minute);
  return useMemo(() => (replay ? countAt(replay, wholeMinute * 60) : null), [replay, wholeMinute]);
}

// One running count for everyone the hazard reached: a single bar whose ink part is the homes already out on time
// and whose red part is the homes that asked for a ride and are still waiting. The rest of the track is everyone else
// in the hazard's path. The two figures under it carry the same colors as their parts of the bar.
export function ReplayTally({ count }: { count: ReplayCount }) {
  const share = (n: number) => `${(100 * n) / Math.max(count.atRisk, 1)}%`;
  return (
    <div
      role="status"
      aria-label={`${count.outOnTime} of ${count.atRisk} households in the hazard's path out on time, ${count.waiting} still waiting for a ride`}
      className="pointer-events-none w-64 rounded-xl bg-map-paper/95 p-3 text-map-ink shadow-[var(--shadow-float)]"
    >
      <div className="flex h-2.5 overflow-hidden rounded-full bg-map-ink/10">
        <div className="bg-map-ink transition-[width] duration-150" style={{ width: share(count.outOnTime) }} />
        <div className="bg-signal transition-[width] duration-150" style={{ width: share(count.waiting) }} />
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-4 tabular-nums">
        <TallyFigure value={count.outOnTime} label="out on time" tone="text-map-ink" />
        <TallyFigure value={count.waiting} label="waiting" tone="text-signal" alignEnd />
      </div>
    </div>
  );
}

function TallyFigure({ value, label, tone, alignEnd = false }: { value: number; label: string; tone: string; alignEnd?: boolean }) {
  return (
    <p className={`flex flex-col ${alignEnd ? "items-end" : "items-start"}`}>
      <span className={`type-title ${tone}`}>{value.toLocaleString()}</span>
      <span className="type-caption text-map-ink/70">{label}</span>
    </p>
  );
}
