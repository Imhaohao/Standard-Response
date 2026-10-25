"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CITY } from "@/lib/cities";
import { boardingMinutesFor } from "@/convex/model";
import { LatLng } from "@/lib/geo";
import { InkMapData, Point } from "@/lib/ink-map/data";
import { arrivalMinutesAt } from "@/lib/ink-map/fire-field";
import { CREW_METERS_PER_MINUTE, CrewHome, CrewRun, CrewStart, FIRE_STATIONS, planCrews, Station, STREET_DETOUR, TURNOUT_MINUTES } from "@/lib/ink-map/fire-crews";
import { Hazard } from "@/lib/ink-map/hazard";
import { streetDrive } from "@/lib/ink-map/road-route";
import { nearestStreetNode, StreetNetwork, streetNetwork } from "@/lib/ink-map/street-network";
import { Home } from "./marks";

// A knock, a look inside and a word with whoever answers, before helping anyone out.
const DOOR_MINUTES = 2;
// Someone who needs help getting out (a walker, a wheelchair, a lift) is who the crews go to first.
const MOBILITY_NEED = 0.5;
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

// Homes in the fire's path. Only what doesn't change during the night goes in (where, when the
// fire arrives, how much help getting out), so the plan never jumps as the calls come back.
function crewHomes(homes: Home[], hazard: Hazard, toLocal: (point: LatLng) => Point): CrewHome[] {
  return homes.flatMap((home) => {
    const at = toLocal(home);
    const fireMinutes = arrivalMinutesAt(hazard.field, at);
    if (fireMinutes === null) return [];
    const boarding = boardingMinutesFor(home);
    const need = home.needProbability + (boarding > 2 ? MOBILITY_NEED : 0);
    return [{ id: home._id, at, fireMinutes, dwellMinutes: DOOR_MINUTES + boarding, need }];
  });
}

const signature = (homes: CrewHome[]) => homes.map((home) => `${home.id}:${home.fireMinutes}:${home.dwellMinutes}:${home.need}`).join("|");

// The same homes keep the same array, so a call coming back doesn't re-plan the night.
function useSteadyHomes(homes: CrewHome[]) {
  const [steady, setSteady] = useState({ homes, key: signature(homes) });
  const key = signature(homes);
  if (key !== steady.key) setSteady({ homes, key });
  return key === steady.key ? steady.homes : homes;
}

export type FireCrews = { runs: CrewRun[]; homeAddress: Map<string, string> };

// The night's fire crews for the rescue map, planned against whichever fire the map is showing.
export function useFireCrews({
  data,
  homes,
  hazard,
  control,
  lit,
  toLocal,
  cityId = DEFAULT_CITY,
}: {
  data: InkMapData | null;
  homes: Home[];
  hazard: Hazard | null;
  // Crews roll once the warning is out, or as soon as the dispatcher lights a rehearsal fire.
  control: { warningIssuedAt?: number } | null | undefined;
  lit: boolean;
  toLocal: (point: LatLng) => Point;
  cityId?: string;
}): FireCrews | null {
  const active = control?.warningIssuedAt !== undefined || lit;
  const fire = active && hazard && hazard.burns !== false ? hazard : null;
  const candidates = useMemo(() => (fire ? crewHomes(homes, fire, toLocal) : []), [homes, fire, toLocal]);
  const steady = useSteadyHomes(candidates);
  const runs = useMemo(() => {
    if (!data || !fire) return null;
    return planCrews(crewStarts(data, cityId, toLocal), steady, (from, to) => streetDrive(data, from, to, NO_CLOSURES));
  }, [data, fire, steady, toLocal, cityId]);
  const homeAddress = useMemo(() => new Map(homes.map((home) => [home._id as string, home.address])), [homes]);
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
