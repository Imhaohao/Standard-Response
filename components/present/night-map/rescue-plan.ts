"use client";

import { useMemo } from "react";
import type { InkMapData, Point } from "@/lib/ink-map/data";
import { streetDrive } from "@/lib/ink-map/road-route";
import { searchPlans, type Plan, type Vehicle } from "./plan";
import type { Home, Town } from "./town";

// Who the rescue map plans for around Roseland: needing homes spread across her part of town, her neighbour
// and other neighbours who offered a seat, and two engines coming in from the nearest edge of the zone.
const REQUESTS = 14;
const AREA_METERS = 1300;
const SPREAD_METERS = 220;
const NEIGHBOURS = 4;
const NEIGHBOUR_SEATS = 2;
const ENGINES = 2;
const ENGINE_SEATS = 4;
const ENGINE_SPACING_METERS = 260;
const ENGINE_OUTSIDE_METERS = 250;
const NO_CLOSURES = new Set<string>();

export type Rescuer = { start: Point; kind: "neighbour" | "engine" };
// `tried` holds each candidate plan the search considered, already drawn along the streets.
// Every run ends at `safe`, just outside the zone edge the engines come in by, so every route leaves town.
export type RescuePlan = { stops: Point[]; rescuers: Rescuer[]; safe: Point; tried: Point[][][]; routes: Point[][] };

const distance = ([ax, ay]: Point, [bx, by]: Point) => Math.hypot(ax - bx, ay - by);

// Homes of one kind near `center`, nearest first, skipping any within SPREAD_METERS of one already taken.
function spreadAround(homes: Home[], census: Home["census"], center: Point, count: number, skip: Home) {
  const near = homes.filter((home) => home.census === census && home !== skip && distance(home.at, center) < AREA_METERS);
  near.sort((a, b) => distance(a.at, center) - distance(b.at, center));
  const taken: Home[] = [];
  for (const home of near) {
    if (taken.length === count) break;
    if (distance(home.at, center) > SPREAD_METERS && taken.every((other) => distance(other.at, home.at) > SPREAD_METERS)) taken.push(home);
  }
  return taken;
}

// Two engines side by side just outside the zone edge nearest Roseland.
function engineStarts(zone: Point[], center: Point): Point[] {
  const edge = zone.reduce((best, point) => (distance(point, center) < distance(best, center) ? point : best));
  const [dx, dy] = [edge[0] - center[0], edge[1] - center[1]];
  const length = Math.hypot(dx, dy) || 1;
  const [ox, oy] = [(dx / length) * ENGINE_OUTSIDE_METERS, (dy / length) * ENGINE_OUTSIDE_METERS];
  const [sx, sy] = [(-dy / length) * ENGINE_SPACING_METERS, (dx / length) * ENGINE_SPACING_METERS];
  return Array.from({ length: ENGINES }, (_, i) => {
    const k = i - (ENGINES - 1) / 2;
    return [edge[0] + ox + sx * k, edge[1] + oy + sy * k];
  });
}

function buildPlan(data: InkMapData, town: Town): RescuePlan {
  const center = town.roseland.at;
  const others = spreadAround(town.homes, "need", center, REQUESTS - 1, town.roseland);
  const stops = [center, ...others.map((home) => home.at)];
  const neighbours = spreadAround(town.homes, "help", center, NEIGHBOURS - 1, town.maria);
  const rescuers: Rescuer[] = [
    { start: town.maria.at, kind: "neighbour" },
    ...neighbours.map((home): Rescuer => ({ start: home.at, kind: "neighbour" })),
    ...engineStarts(town.zone, center).map((start): Rescuer => ({ start, kind: "engine" })),
  ];
  const vehicles: Vehicle[] = rescuers.map((rescuer, i) => ({
    start: rescuer.start,
    seats: rescuer.kind === "engine" ? ENGINE_SEATS : NEIGHBOUR_SEATS,
    firstStop: i === 0 ? 0 : undefined,
  }));
  const { tried, best } = searchPlans(vehicles, stops);
  const safe = midpoint(rescuers.filter((r) => r.kind === "engine").map((r) => r.start));
  const along = streetLegs(data, rescuers.map((r) => r.start), stops, safe);
  const drawn = (plan: Plan) => plan.map((run, v) => along(v, run));
  return { stops, rescuers, safe, tried: tried.map(drawn), routes: drawn(best) };
}

const midpoint = (points: Point[]): Point => [points.reduce((sum, [x]) => sum + x, 0) / points.length, points.reduce((sum, [, y]) => sum + y, 0) / points.length];

// Every run is drawn along the streets, one leg per stop and a last leg out to safety. A leg between
// the same two places is found once and reused, since the candidate plans share most of their legs.
function streetLegs(data: InkMapData, starts: Point[], stops: Point[], safe: Point) {
  const legs = new Map<string, Point[]>();
  const leg = (from: Point, to: Point, key: string) => {
    let route = legs.get(key);
    if (!route) {
      route = streetDrive(data, from, to, NO_CLOSURES) ?? [from, to];
      legs.set(key, route);
    }
    return route;
  };
  return (vehicle: number, run: number[]) => {
    const route: Point[] = [];
    let [from, fromKey] = [starts[vehicle], `v${vehicle}`];
    for (const stop of run) {
      route.push(...leg(from, stops[stop], `${fromKey}>${stop}`));
      [from, fromKey] = [stops[stop], `s${stop}`];
    }
    if (run.length) route.push(...leg(from, safe, `${fromKey}>safe`));
    return route;
  };
}

export function useRescuePlan(data: InkMapData | null, town: Town | null) {
  return useMemo(() => (data && town ? buildPlan(data, town) : null), [data, town]);
}
