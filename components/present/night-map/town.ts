"use client";

import { useEffect, useMemo, useState } from "react";
import type { Household } from "@/lib/crowd/langevin";
import { createProjection, type Point } from "@/lib/ink-map/data";
import { arrivalMinutesAt, contains } from "@/lib/ink-map/fire-field";
import type { StoryMap } from "./use-story-map";

// What the network census finds in the evacuation zone, in the rescue map's colours.
export type Census = "need" | "help" | "left" | "unreached";
export type Home = { at: Point; census: Census; hash: number };
export type Town = { households: Household[]; zone: Point[]; homes: Home[]; roseland: Home; maria: Home };

// The zone covers every home the scenario fire reaches within this share of the time it takes to
// reach the story house, so the story house sits well inside it.
const ZONE_REACH = 1.5;
// Shares of the answering, able households that offer a seat or never pick up. The households are
// the synthetic population in data/population.json; these two shares are the deck's stand-ins.
const UNREACHED_SHARE = 0.14;
const HELPER_SHARE = 0.06;
// Roseland lives between the story house and the middle of the zone, and Maria, her neighbour with a
// van, is the helping home nearest this far from her.
const MARIA_FROM_ROSELAND_METERS = 150;

const hashOf = (i: number) => ((i * 2654435761) % 4294967296) / 4294967296;

function censusOf(household: Household, hash: number): Census {
  if (household.canLeave !== "yes") return "need";
  if (hash < UNREACHED_SHARE) return "unreached";
  if (household.hasCar && hash < UNREACHED_SHARE + HELPER_SHARE) return "help";
  return "left";
}

export function centroid(ring: Point[]): Point {
  return ring.reduce<Point>((sum, [x, y]) => [sum[0] + x / ring.length, sum[1] + y / ring.length], [0, 0]);
}

function nearestTo(homes: Home[], census: Census, [x, y]: Point, meters: number) {
  let best = homes[0];
  let bestGap = Infinity;
  for (const home of homes) {
    if (home.census !== census) continue;
    const gap = Math.abs(Math.hypot(home.at[0] - x, home.at[1] - y) - meters);
    if (gap < bestGap) [best, bestGap] = [home, gap];
  }
  return best;
}

// The zone is drawn around the homes the fire reaches in time, a little way out from them, so it
// covers the households we have rather than the fire front's whole reach into the hills.
const ZONE_MARGIN_METERS = 180;

function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

function padded(ring: Point[], meters: number): Point[] {
  const [cx, cy] = centroid(ring);
  return ring.map(([x, y]) => {
    const length = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / length) * meters, y + ((y - cy) / length) * meters];
  });
}

function zoneRing(story: StoryMap, points: Point[]) {
  const reach = story.house.arrives * ZONE_REACH;
  const reached = points.filter((point) => (arrivalMinutesAt(story.fire, point) ?? Infinity) <= reach);
  return reached.length >= 3 ? padded(hull(reached), ZONE_MARGIN_METERS) : null;
}

function buildTown(story: StoryMap, households: Household[]): Town | null {
  const toLocal = createProjection(story.data.origin).toLocal;
  const points = households.map(toLocal);
  const zone = zoneRing(story, points);
  if (!zone) return null;
  const homes: Home[] = [];
  for (const [i, household] of households.entries()) {
    const at = points[i];
    if (!contains(zone, at[0], at[1])) continue;
    const hash = hashOf(i + 1);
    homes.push({ at, census: censusOf(household, hash), hash });
  }
  const [cx, cy] = centroid(zone);
  const between: Point = [(story.house.center[0] + cx) / 2, (story.house.center[1] + cy) / 2];
  const roseland = nearestTo(homes, "need", between, 0);
  const maria = nearestTo(homes, "help", roseland.at, MARIA_FROM_ROSELAND_METERS);
  return { households, zone, homes, roseland, maria };
}

function useHouseholds() {
  const [households, setHouseholds] = useState<Household[] | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/flow")
      .then((response) => response.json() as Promise<{ households?: Household[] }>)
      .then((flow) => live && setHouseholds(flow.households ?? []));
    return () => {
      live = false;
    };
  }, []);
  return households;
}

export function useTown(story: StoryMap | null): Town | null {
  const households = useHouseholds();
  return useMemo(() => (story && households?.length ? buildTown(story, households) : null), [story, households]);
}
