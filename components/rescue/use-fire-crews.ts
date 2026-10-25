"use client";

import { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { DEFAULT_CITY } from "@/lib/cities";
import { boardingMinutesFor } from "@/convex/model";
import { LatLng } from "@/lib/geo";
import { InkMapData, Point } from "@/lib/ink-map/data";
import { arrivalMinutesAt } from "@/lib/ink-map/fire-field";
import {
  CREW_METERS_PER_MINUTE,
  CrewHome,
  CrewRun,
  CrewStart,
  DriveRoute,
  FIRE_STATIONS,
  planCrews,
  QueueSnapshot,
  Station,
  STREET_DETOUR,
  TURNOUT_MINUTES,
} from "@/lib/ink-map/fire-crews";
import { Hazard } from "@/lib/ink-map/hazard";
import { streetDrive } from "@/lib/ink-map/road-route";
import { nearestStreetNode, StreetNetwork, streetNetwork } from "@/lib/ink-map/street-network";
import { Home } from "./marks";

export type DoorQueue = FunctionReturnType<typeof api.doorChecks.queue>;

// A knock, a look inside and a word with whoever answers, before helping anyone out.
const DOOR_MINUTES = 2;
// A listed home the map hasn't loaded yet is taken to walk out on its own, boardingMinutesFor's least.
const WALKS_OUT_MINUTES = 2;
// How far off the baked streets a station may sit and still send an engine onto them.
const FARTHEST_STATION_METERS = 9000;
const ON_STREETS_METERS = 600;
// Engines drive through closures: those keep the public out, not the fire department.
const NO_CLOSURES = new Set<string>();

function crewStart(network: StreetNetwork, station: Station, toLocal: (point: LatLng) => Point): CrewStart | null {
  const base = { engine: station.engine, station: station.name };
  const at = toLocal(station.at);
  if (nearestStreetNode(network, at, ON_STREETS_METERS) !== null) return { ...base, at, leavesAt: TURNOUT_MINUTES, joinsAtEdge: false };
  const edge = nearestStreetNode(network, at, FARTHEST_STATION_METERS);
  if (edge === null) return null;
  const entry = network.points[edge];
  const approach = (Math.hypot(entry[0] - at[0], entry[1] - at[1]) * STREET_DETOUR) / CREW_METERS_PER_MINUTE;
  return { ...base, at: entry, leavesAt: TURNOUT_MINUTES + approach, joinsAtEdge: true };
}

function crewStarts(data: InkMapData, cityId: string, toLocal: (point: LatLng) => Point): CrewStart[] {
  const network = streetNetwork(data);
  return (FIRE_STATIONS[cityId] ?? []).flatMap((station) => crewStart(network, station, toLocal) ?? []);
}

// The door-check list in its own order, with what a crew needs: where, when the fire gets there
// (never, for a home outside its path) and how long the door takes. A home with no place on the map
// yet (an address still being matched) can't be driven to, so it waits off the crews' list.
function crewHomes(queue: DoorQueue, households: Map<string, Home>, hazard: Hazard, toLocal: (point: LatLng) => Point): CrewHome[] {
  return queue.flatMap(({ _id, lat, lng }) => {
    if (lat === undefined || lng === undefined) return [];
    const at = toLocal({ lat, lng });
    const household = households.get(_id);
    const boarding = household ? boardingMinutesFor(household) : WALKS_OUT_MINUTES;
    return [{ id: _id, at, fireMinutes: arrivalMinutesAt(hazard.field, at) ?? Infinity, dwellMinutes: DOOR_MINUTES + boarding }];
  });
}

const signature = (homes: CrewHome[]) => homes.map((home) => `${home.id}:${home.dwellMinutes}`).join("|");

type Timeline = { fire: Hazard | null; startedAt?: number; key: string | null; snapshots: QueueSnapshot[] };

// The list over the night, one snapshot each time it changes, stamped with the fire minute it changed
// at. The first one the page sees stands from the warning. A new snapshot replaces any stamped at or
// after its minute (the clock went back), and a new fire or a new warning starts over.
function nextTimeline(current: Timeline, fire: Hazard | null, startedAt: number | undefined, homes: CrewHome[] | null, minutes: number): Timeline {
  const sameNight = current.fire === fire && current.startedAt === startedAt;
  const key = homes ? signature(homes) : null;
  if (sameNight && (key === null || key === current.key)) return current;
  if (!homes || key === null) return { fire, startedAt, key: null, snapshots: [] };
  const kept = sameNight ? current.snapshots.filter((snapshot) => snapshot.fromMinutes < minutes) : [];
  return { fire, startedAt, key, snapshots: [...kept, { fromMinutes: kept.length === 0 ? 0 : minutes, homes }] };
}

function useQueueTimeline(fire: Hazard | null, startedAt: number | undefined, homes: CrewHome[] | null, minutes: number) {
  const [timeline, setTimeline] = useState<Timeline>({ fire: null, key: null, snapshots: [] });
  const next = nextTimeline(timeline, fire, startedAt, homes, minutes);
  if (next !== timeline) setTimeline(next);
  return next.snapshots;
}

// Every re-plan drives the same streets up to the minute the list changed, so routes are kept.
function useRememberedRoutes(data: InkMapData | null): DriveRoute | null {
  return useMemo(() => {
    if (!data) return null;
    const routes = new Map<string, Point[] | null>();
    return (from, to) => {
      const key = `${from[0]},${from[1]}>${to[0]},${to[1]}`;
      if (!routes.has(key)) routes.set(key, streetDrive(data, from, to, NO_CLOSURES));
      return routes.get(key) ?? null;
    };
  }, [data]);
}

export type FireCrews = { runs: CrewRun[]; homeAddress: Map<string, string> };

// The night's fire crews for the rescue map, working the door-check list against whichever fire the
// map is showing. `minutes` is the night clock's fire minute (useFireClock), the clock the list
// changes on, so the crews and the list stay in step even while a truck drill replays.
export function useFireCrews({
  data,
  homes,
  queue,
  hazard,
  startedAt,
  minutes,
  toLocal,
  cityId = DEFAULT_CITY,
}: {
  data: InkMapData | null;
  homes: Home[];
  queue: DoorQueue | undefined;
  hazard: Hazard | null;
  // When the fire's clock started: the warning, or the moment the dispatcher lit a rehearsal fire.
  startedAt: number | undefined;
  minutes: number;
  toLocal: (point: LatLng) => Point;
  cityId?: string;
}): FireCrews | null {
  const fire = startedAt !== undefined && hazard && hazard.burns !== false ? hazard : null;
  const households = useMemo(() => new Map(homes.map((home) => [home._id as string, home])), [homes]);
  const listed = useMemo(() => (fire && queue ? crewHomes(queue, households, fire, toLocal) : null), [fire, queue, households, toLocal]);
  const snapshots = useQueueTimeline(fire, startedAt, listed, minutes);
  const drive = useRememberedRoutes(data);
  const runs = useMemo(() => {
    if (!data || !fire || !drive || snapshots.length === 0) return null;
    return planCrews(crewStarts(data, cityId, toLocal), snapshots, drive);
  }, [data, fire, drive, snapshots, toLocal, cityId]);
  const homeAddress = useMemo(() => {
    const addresses = new Map(homes.map((home) => [home._id as string, home.address]));
    for (const listedHome of queue ?? []) addresses.set(listedHome._id, listedHome.address);
    return addresses;
  }, [homes, queue]);
  return runs ? { runs, homeAddress } : null;
}

const FRAME_MS = 50;

// The fire clock moves in tenth-of-a-minute steps; an engine stepping 50 m at a time looks broken.
// Between steps this runs the clock on at the pace it was last moving, never more than one step ahead.
export function useSmoothMinutes(minutes: number) {
  const [lead, setLead] = useState({ base: minutes, ahead: 0 });
  const pace = useRef({ minutes, at: 0 });
  useEffect(() => {
    const now = performance.now();
    const previous = pace.current;
    const step = minutes - previous.minutes;
    const rate = previous.at > 0 && step > 0 && step < 1 ? step / (now - previous.at) : 0;
    pace.current = { minutes, at: now };
    if (rate === 0) return;
    const id = window.setInterval(() => setLead({ base: minutes, ahead: Math.min((performance.now() - now) * rate, step) }), FRAME_MS);
    return () => window.clearInterval(id);
  }, [minutes]);
  return lead.base === minutes ? minutes + lead.ahead : minutes;
}
