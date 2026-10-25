import type { Point } from "@/lib/ink-map/data";
import { seededRandom, type Random } from "@/lib/mesh/random";

// A small large-neighbourhood search over straight-line distance, so the deck can show what the
// dispatcher's ALNS does: tear a few stops out of a plan, put them back where they cost least, and
// keep the result when it is shorter. Every candidate it tries is kept for the flicker on screen.

export type Vehicle = { start: Point; seats: number; firstStop?: number };
export type Plan = number[][];
export type Search = { tried: Plan[]; best: Plan };

const ITERATIONS = 400;
const TORN_PER_ROUND = 3;
const KEEP_TRIED = 48;

const gap = ([ax, ay]: Point, [bx, by]: Point) => Math.hypot(ax - bx, ay - by);

function runLength(vehicle: Vehicle, run: number[], stops: Point[]) {
  let length = 0;
  let from = vehicle.start;
  for (const stop of run) {
    length += gap(from, stops[stop]);
    from = stops[stop];
  }
  return length;
}

const planLength = (plan: Plan, vehicles: Vehicle[], stops: Point[]) => plan.reduce((sum, run, v) => sum + runLength(vehicles[v], run, stops), 0);

// The cheapest place for one stop across every run that still has a seat. A pinned first stop stays first.
function insertCheapest(plan: Plan, stop: number, vehicles: Vehicle[], stops: Point[]) {
  let best = { cost: Infinity, v: -1, at: 0 };
  for (const [v, run] of plan.entries()) {
    if (run.length >= vehicles[v].seats) continue;
    const before = runLength(vehicles[v], run, stops);
    const from = vehicles[v].firstStop === undefined ? 0 : 1;
    for (let at = from; at <= run.length; at++) {
      const cost = runLength(vehicles[v], [...run.slice(0, at), stop, ...run.slice(at)], stops) - before;
      if (cost < best.cost) best = { cost, v, at };
    }
  }
  if (best.v >= 0) plan[best.v].splice(best.at, 0, stop);
}

function tear(plan: Plan, random: Random, pinned: Set<number>) {
  const torn: number[] = [];
  const loose = plan.flat().filter((stop) => !pinned.has(stop));
  for (let i = 0; i < TORN_PER_ROUND && loose.length; i++) torn.push(...loose.splice(Math.floor(random() * loose.length), 1));
  const kept = plan.map((run) => run.filter((stop) => !torn.includes(stop)));
  return { kept, torn };
}

export function searchPlans(vehicles: Vehicle[], stops: Point[], seed = 11): Search {
  const random = seededRandom(seed);
  const pinned = new Set(vehicles.flatMap((v) => (v.firstStop === undefined ? [] : [v.firstStop])));
  let best: Plan = vehicles.map((v) => (v.firstStop === undefined ? [] : [v.firstStop]));
  for (const stop of stops.keys()) if (!pinned.has(stop)) insertCheapest(best, stop, vehicles, stops);
  let bestLength = planLength(best, vehicles, stops);
  const tried: Plan[] = [];
  for (let round = 0; round < ITERATIONS; round++) {
    const { kept, torn } = tear(best, random, pinned);
    for (const stop of torn.sort(() => random() - 0.5)) insertCheapest(kept, stop, vehicles, stops);
    const length = planLength(kept, vehicles, stops);
    if (round % Math.ceil(ITERATIONS / KEEP_TRIED) === 0) tried.push(kept);
    if (length < bestLength) [best, bestLength] = [kept, length];
  }
  return { tried, best };
}
