"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { positionAt } from "@/convex/vehicleRun";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";

export type Drill = NonNullable<FunctionReturnType<typeof api.truckDrill.latest>>;
export type DrillHome = Drill["homes"][number];
// What a home on the drill's list looks like at a moment of the playback.
export type HomeState = "waiting" | "rescued" | "too_late" | "never_reached";

// Seconds into the drill (after the warning) on the playback clock, re-read every `tickMs` until it ends.
export function useDrillSeconds(drill: Drill | null | undefined, tickMs: number) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!drill) return;
    const read = () => Math.min(drill.endSeconds, ((Date.now() - drill.ranAt) / 1000) * drill.playbackRate);
    const tick = () => {
      const now = read();
      setSeconds(now);
      if (now >= drill.endSeconds) clearInterval(id);
    };
    const id = setInterval(tick, tickMs);
    tick();
    return () => clearInterval(id);
  }, [drill, tickMs]);
  return drill ? seconds : 0;
}

// The latest drill for the rescue map. While one is on the map the fire plays on the drill's clock,
// so the truck races the same front it is drawn against.
export function useDrillOnMap(toLocal: (point: LatLng) => Point, nightMinutes: number) {
  const drill = useQuery(api.truckDrill.latest);
  const localDrill = useLocalDrill(drill, toLocal);
  const seconds = useDrillSeconds(drill, 250);
  return { drill, localDrill, fireMinutes: drill ? seconds / 60 : nightMinutes };
}

export function homeStateAt(home: DrillHome, seconds: number): HomeState {
  if (home.outcome === "never_reached") return home.fireSeconds <= seconds ? "never_reached" : "waiting";
  return home.reachedSeconds !== null && home.reachedSeconds <= seconds ? home.outcome : "waiting";
}

export type DrillCounts = Record<HomeState, { homes: number; people: number }>;

export function countsAt(drill: Drill, seconds: number): DrillCounts {
  const counts: DrillCounts = {
    waiting: { homes: 0, people: 0 },
    rescued: { homes: 0, people: 0 },
    too_late: { homes: 0, people: 0 },
    never_reached: { homes: 0, people: 0 },
  };
  for (const home of drill.homes) {
    const count = counts[homeStateAt(home, seconds)];
    count.homes += 1;
    count.people += home.people;
  }
  return counts;
}

type LocalLeg = { startSeconds: number; endSeconds: number; path: Point[]; legSeconds: number[] };

// The drill's legs and homes in map coordinates, worked out once per drill.
export function useLocalDrill(drill: Drill | null | undefined, toLocal: (point: LatLng) => Point) {
  return useMemo(() => {
    if (!drill) return null;
    const legs: LocalLeg[] = drill.legs.map((leg) => ({
      ...leg,
      path: leg.path.map(toLocal),
      endSeconds: leg.startSeconds + leg.legSeconds.reduce((sum, s) => sum + s, 0),
    }));
    return { legs, homes: drill.homes.map((home) => ({ ...home, at: toLocal(home) })), station: toLocal(drill.station), shelter: toLocal(drill.shelter) };
  }, [drill, toLocal]);
}

export type LocalDrill = NonNullable<ReturnType<typeof useLocalDrill>>;

function legIndexAt(legs: LocalLeg[], seconds: number) {
  let index = -1;
  for (const [i, leg] of legs.entries()) if (leg.startSeconds <= seconds) index = i;
  return index;
}

// Where the truck is, whether it is moving, and how many people ride with it.
export function truckAt(drill: Drill, local: LocalDrill, seconds: number) {
  const index = legIndexAt(local.legs, seconds);
  const leg = local.legs[index];
  const onboard = drill.stops.filter((stop) => stop.atSeconds <= seconds).at(-1)?.onboard ?? 0;
  if (!leg) return { at: local.station, legIndex: -1, moving: false, onboard };
  if (seconds >= leg.endSeconds) return { at: leg.path[leg.path.length - 1], legIndex: index, moving: false, onboard };
  // positionAt interpolates any pair of coordinates; the leg's local x and y ride in its lat and lng.
  const along = positionAt({ path: leg.path.map(([x, y]) => ({ lat: x, lng: y })), legSeconds: leg.legSeconds }, seconds - leg.startSeconds);
  return { at: [along.lat, along.lng] as Point, legIndex: index, moving: true, onboard };
}
