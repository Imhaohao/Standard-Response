"use client";

import { Van as VanIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { HomeMark, MAP_TONE } from "@/components/floor/household-mark";
import { GeoAnchor, GeoLine } from "@/components/map/layers";
import { buildPlaceIndex, buildingForPoint } from "@/lib/ink-map/place";
import { BuildingState } from "@/lib/ink-map/renderer";
import { createProjection, InkMapData } from "@/lib/ink-map/data";
import { countAt, decodeReplay, homeStateAt, HomeState, Replay, ReplayCount, ReplayFile, vanAt } from "@/lib/replay/replay";

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

// How a household's roof reads at one moment. Red is a person who needs a ride; it stays red until
// they are aboard, so nobody who was missed fades out of the picture.
const ROOF: Partial<Record<HomeState, BuildingState>> = {
  needsRide: { level: 0.95, pulse: true },
  vanComing: { level: 0.6, pulse: false },
  leaving: { level: 0, pulse: false, occupancy: "left" },
  aboard: { level: 0, pulse: false, occupancy: "left" },
};

function useHomeBuildings(replay: Replay | null, data: InkMapData | null) {
  return useMemo(() => {
    if (!replay || !data) return [];
    const index = buildPlaceIndex(data);
    const { toLocal } = createProjection(data.origin);
    return replay.homes.map((home) => buildingForPoint(index, data, toLocal(home)));
  }, [replay, data]);
}

// Roofs for MapStage's `highlights`, recomputed once a scene minute: the renderer repaints every
// building it is handed, so a per-frame map would cost far more than the minute it shows.
export function useReplayHighlights(replay: Replay | null, data: InkMapData | null, minute: number) {
  const buildings = useHomeBuildings(replay, data);
  const wholeMinute = Math.floor(minute);
  return useMemo(() => {
    const states = new Map<number, BuildingState>();
    if (!replay) return states;
    buildings.forEach((building, home) => {
      if (building === null) return;
      const roof = ROOF[homeStateAt(replay, home, wholeMinute * 60)];
      const held = states.get(building);
      if (roof && (!held || roof.level > held.level)) states.set(building, roof);
    });
    return states;
  }, [replay, buildings, wholeMinute]);
}

type Marked = { home: number; state: HomeState };
const HOME_STEP_S = 15;

function markedHomes(replay: Replay, seconds: number): Marked[] {
  const out: Marked[] = [];
  for (let home = 0; home < replay.homes.length; home++) {
    const state = homeStateAt(replay, home, seconds);
    if (state === "calling" || state === "needsRide" || state === "vanComing") out.push({ home, state });
  }
  return out;
}

function HomeDot({ replay, mark }: { replay: Replay; mark: Marked }) {
  const accessible = replay.file.homes.need[mark.home] === 2;
  if (mark.state === "calling") {
    return (
      <GeoAnchor at={replay.homes[mark.home]}>
        <HomeMark kind="on_phone" r={3.5} tone={MAP_TONE} />
      </GeoAnchor>
    );
  }
  return (
    <GeoAnchor at={replay.homes[mark.home]}>
      {mark.state === "vanComing" && <circle r={8} fill="none" stroke={INK} strokeWidth={1.5} />}
      <HomeMark kind={accessible ? "needs_accessible" : "needs_ride"} r={mark.state === "needsRide" ? 5 : 4} tone={MAP_TONE} />
    </GeoAnchor>
  );
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

// Drawn inside MapStage: who is on the phone, who is waiting for a ride, and every van on its street.
// Red pins draw last so a person waiting is never under a van.
export function ReplayOverlay({ replay, minute }: { replay: Replay; minute: number }) {
  const seconds = minute * 60;
  const bucket = Math.floor(seconds / HOME_STEP_S) * HOME_STEP_S;
  // Built once a step, so a frame that only moves the vans reuses the same home elements.
  const homes = useMemo(() => {
    const marks = markedHomes(replay, bucket);
    const dot = (mark: Marked) => <HomeDot key={mark.home} replay={replay} mark={mark} />;
    return { calling: marks.filter((mark) => mark.state === "calling").map(dot), waiting: marks.filter((mark) => mark.state !== "calling").map(dot) };
  }, [replay, bucket]);
  return (
    <g>
      {homes.calling}
      {replay.file.vehicles.map((_, vehicle) => <VanDot key={vehicle} replay={replay} vehicle={vehicle} seconds={seconds} />)}
      {homes.waiting}
    </g>
  );
}

export const replayLastMinute = (replay: Replay | null) => (replay ? Math.ceil(replay.file.endS / 60) : 0);

export function useReplayCount(replay: Replay | null, minute: number): ReplayCount | null {
  const wholeMinute = Math.floor(minute);
  return useMemo(() => (replay ? countAt(replay, wholeMinute * 60) : null), [replay, wholeMinute]);
}

// One small running count: households out on time (ink) against households still waiting (red),
// as a bar over everyone the hazard reached, with the two numbers that bar stands for.
export function ReplayTally({ count }: { count: ReplayCount }) {
  const share = (n: number) => `${(100 * n) / Math.max(count.atRisk, 1)}%`;
  return (
    <div
      role="status"
      aria-label={`${count.outOnTime} of ${count.atRisk} households out on time, ${count.waiting} still waiting`}
      className="pointer-events-none w-56 rounded-xl bg-map-paper/95 p-3 text-map-ink shadow-[var(--shadow-float)]"
    >
      <div className="flex items-baseline justify-between tabular-nums">
        <span className="text-3xl font-bold">{count.outOnTime}</span>
        <span className="text-xl font-bold text-signal">{count.waiting}</span>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-map-ink/10">
        <div className="bg-map-ink transition-[width] duration-150" style={{ width: share(count.outOnTime) }} />
        <div className="bg-signal transition-[width] duration-150" style={{ width: share(count.waiting) }} />
      </div>
    </div>
  );
}
