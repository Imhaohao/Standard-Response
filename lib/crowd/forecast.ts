import { EDGES } from "../../convex/roadGraph";
import { Segment } from "../mesh/roads";
import { seededRandom } from "../mesh/random";
import { Ground } from "./grid";
import { MIN_SPEED_SHARE } from "./greenshields";
import { CrowdParams, CrowdSim, DEFAULT_CROWD, Household } from "./langevin";
import { freeSpeedOf } from "./navigation";

// A traffic forecast from the Langevin crowd model, for the agency. An ensemble of simulations of
// the town follows the incident on the wall clock, each with its own noise (who leaves when, how
// people drive). To look ahead, every member is forked at the present and run on for an hour; the
// spread across members is the forecast's range. Blocked streets are the ones the agency knows
// about now, held fixed for the hour, and the scenario fire keeps advancing. It forecasts a
// simulation of the synthetic population, not measured traffic.

export const FORECAST_HORIZON_MINUTES = 60;
export const FORECAST_WINDOWS = [
  { from: 0, to: 15 },
  { from: 15, to: 30 },
  { from: 30, to: 60 },
] as const;
const TIMELINE_EVERY_MINUTES = 5;
// A street's speed needs this many samples in a window before its slowdown means anything.
const MIN_SPEED_SAMPLES = 3;
const STREETS_PER_WINDOW = 8;
const SEGMENTS_PER_WINDOW = 150;
// Segments losing less than this (median, car-minutes in the window) are left off the map.
const MIN_LOST_CAR_MINUTES = 0.5;
// Directed edges for the dispatcher's drive times: the ones whose median slowdown is at least this,
// most extra drive time first. An edge left out drives at free flow.
const MIN_EDGE_SLOWDOWN = 0.1;
const EDGES_PER_WINDOW = 600;

export type Range = { median: number | null; p5: number | null; p95: number | null; n: number };

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

export function rangeOf(values: (number | null)[]): Range {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (present.length === 0) return { median: null, p5: null, p95: null, n: 0 };
  return { median: quantile(present, 0.5), p5: quantile(present, 0.05), p95: quantile(present, 0.95), n: present.length };
}

type Window = { from: number; to: number };

type Counters = {
  entries: Uint32Array;
  speedSum: Float64Array;
  samples: Uint32Array;
  lost: Float64Array;
  edgeSpeedSum: Float64Array;
  edgeSamples: Uint32Array;
};

function countersOf(sim: CrowdSim): Counters {
  return {
    entries: sim.segmentEntries.slice(),
    speedSum: sim.segmentSpeedSum.slice(),
    samples: sim.segmentSpeedSamples.slice(),
    lost: sim.segmentLostSeconds.slice(),
    edgeSpeedSum: sim.edgeSpeedSum.slice(),
    edgeSamples: sim.edgeSpeedSamples.slice(),
  };
}

function difference(later: Counters, earlier: Counters): Counters {
  return {
    entries: later.entries.map((value, i) => value - earlier.entries[i]),
    speedSum: later.speedSum.map((value, i) => value - earlier.speedSum[i]),
    samples: later.samples.map((value, i) => value - earlier.samples[i]),
    lost: later.lost.map((value, i) => value - earlier.lost[i]),
    edgeSpeedSum: later.edgeSpeedSum.map((value, i) => value - earlier.edgeSpeedSum[i]),
    edgeSamples: later.edgeSamples.map((value, i) => value - earlier.edgeSamples[i]),
  };
}

type Totals = { moving: number; arrived: number; jammedShare: number; meanSpeed: number };

function totalsOf(sim: CrowdSim): Totals {
  const { moving, arrived, jammedShare, meanSpeed } = sim.stats();
  return { moving, arrived, jammedShare, meanSpeed };
}

export function advance(sim: CrowdSim, minute: number) {
  while (sim.minutes < minute) sim.step();
}

// One member run ahead: totals every few minutes, and street counters over each window.
export type Branch = { timeline: Totals[]; windows: Counters[] };

export function runBranch(sim: CrowdSim, horizon = FORECAST_HORIZON_MINUTES, windows: readonly Window[] = FORECAST_WINDOWS): Branch {
  const start = sim.minutes;
  const marks = new Map<number, Counters>([[0, countersOf(sim)]]);
  const edges = new Set(windows.flatMap((w) => [w.from, w.to]));
  const timeline = [totalsOf(sim)];
  for (let offset = 1; offset <= horizon; offset++) {
    advance(sim, start + offset);
    if (offset % TIMELINE_EVERY_MINUTES === 0) timeline.push(totalsOf(sim));
    if (edges.has(offset)) marks.set(offset, countersOf(sim));
  }
  return { timeline, windows: windows.map((w) => difference(marks.get(w.to)!, marks.get(w.from)!)) };
}

export type TimelinePoint = { minute: number; moving: Range; arrived: Range; jammedShare: Range; meanSpeed: Range };
export type StreetForecast = { name: string; lostCarMinutes: Range; slowdown: Range; cars: Range };
export type SegmentForecast = { key: string; lostCarMinutes: Range; slowdown: Range };
// One direction of a street (the road graph's directed edge key), for the dispatcher's drive times.
export type EdgeForecast = { key: string; slowdown: Range };
export type WindowForecast = { from: number; to: number; streets: StreetForecast[]; segments: SegmentForecast[]; edges: EdgeForecast[] };
export type TrafficForecast = {
  baseMinute: number;
  horizonMinutes: number;
  members: number;
  households: number;
  timeline: TimelinePoint[];
  windows: WindowForecast[];
};

function timelineOf(branches: Branch[]): TimelinePoint[] {
  return branches[0].timeline.map((_, k) => ({
    minute: k * TIMELINE_EVERY_MINUTES,
    moving: rangeOf(branches.map((b) => b.timeline[k].moving)),
    arrived: rangeOf(branches.map((b) => b.timeline[k].arrived)),
    jammedShare: rangeOf(branches.map((b) => b.timeline[k].jammedShare)),
    meanSpeed: rangeOf(branches.map((b) => b.timeline[k].meanSpeed)),
  }));
}

// Share of free-flow speed lost, over a set of segments: 1 - mean speed / sample-weighted free speed.
// Speeds are along each car's route, so a stalled street's mean can dip below 0; the share stops at 1.
function slowdownOf(counters: Counters, members: number[], segments: Segment[]) {
  let speed = 0;
  let free = 0;
  let samples = 0;
  for (const s of members) {
    speed += counters.speedSum[s];
    free += (counters.samples[s] * segments[s].kph) / 3.6;
    samples += counters.samples[s];
  }
  return samples < MIN_SPEED_SAMPLES || free <= 0 ? null : Math.min(1, Math.max(0, 1 - speed / free));
}

// One direction of one street in one member. A member with too few cars on it to measure is free
// flow there: a vehicle driving it meets no traffic.
function edgeSlowdownOf(counters: Counters, edge: number) {
  const samples = counters.edgeSamples[edge];
  if (samples < MIN_SPEED_SAMPLES) return 0;
  return Math.min(1, Math.max(0, 1 - counters.edgeSpeedSum[edge] / (samples * freeSpeedOf(edge))));
}

// Seconds a slowdown adds to one drive along the edge, by the same floor the dynamics use.
const extraSeconds = (edge: number, slowdown: number) => EDGES[edge].seconds * (1 / Math.max(MIN_SPEED_SHARE, 1 - slowdown) - 1);

function edgesOf(windows: Counters[]): EdgeForecast[] {
  const rows: { edge: EdgeForecast; extra: number }[] = [];
  for (let e = 0; e < EDGES.length; e++) {
    const slowdown = rangeOf(windows.map((w) => edgeSlowdownOf(w, e)));
    if ((slowdown.median ?? 0) < MIN_EDGE_SLOWDOWN) continue;
    rows.push({ edge: { key: EDGES[e].key, slowdown }, extra: extraSeconds(e, slowdown.median!) });
  }
  return rows.sort((a, b) => b.extra - a.extra).slice(0, EDGES_PER_WINDOW).map((row) => row.edge);
}

const lostMinutesOf = (counters: Counters, members: number[]) => members.reduce((sum, s) => sum + counters.lost[s], 0) / 60;

const byMedianLost = (a: { lostCarMinutes: Range }, b: { lostCarMinutes: Range }) =>
  (b.lostCarMinutes.median ?? 0) - (a.lostCarMinutes.median ?? 0);

function segmentsOf(windows: Counters[], segments: Segment[]): SegmentForecast[] {
  const rows: SegmentForecast[] = [];
  for (const [s, segment] of segments.entries()) {
    const lostCarMinutes = rangeOf(windows.map((w) => w.lost[s] / 60));
    if ((lostCarMinutes.median ?? 0) < MIN_LOST_CAR_MINUTES) continue;
    rows.push({ key: segment.key, lostCarMinutes, slowdown: rangeOf(windows.map((w) => slowdownOf(w, [s], segments))) });
  }
  return rows.sort(byMedianLost).slice(0, SEGMENTS_PER_WINDOW);
}

function streetGroups(segments: Segment[]) {
  const groups = new Map<string, number[]>();
  for (const [s, segment] of segments.entries()) {
    if (!segment.name) continue;
    groups.set(segment.name, [...(groups.get(segment.name) ?? []), s]);
  }
  return groups;
}

// Cars through a street: the busiest of its segments, since one car passes several.
const carsThrough = (counters: Counters, members: number[]) => Math.max(0, ...members.map((s) => counters.entries[s]));

function streetsOf(windows: Counters[], segments: Segment[], groups: Map<string, number[]>): StreetForecast[] {
  const rows: StreetForecast[] = [];
  for (const [name, members] of groups) {
    const lostCarMinutes = rangeOf(windows.map((w) => lostMinutesOf(w, members)));
    if ((lostCarMinutes.median ?? 0) < MIN_LOST_CAR_MINUTES) continue;
    rows.push({
      name,
      lostCarMinutes,
      slowdown: rangeOf(windows.map((w) => slowdownOf(w, members, segments))),
      cars: rangeOf(windows.map((w) => carsThrough(w, members))),
    });
  }
  return rows.sort(byMedianLost).slice(0, STREETS_PER_WINDOW);
}

export function summarize(branches: Branch[], segments: Segment[], baseMinute: number, households: number, windows: readonly Window[] = FORECAST_WINDOWS): TrafficForecast {
  const groups = streetGroups(segments);
  return {
    baseMinute,
    horizonMinutes: FORECAST_HORIZON_MINUTES,
    members: branches.length,
    households,
    timeline: timelineOf(branches),
    windows: windows.map((window, k) => {
      const counters = branches.map((b) => b.windows[k]);
      return {
        from: window.from,
        to: window.to,
        streets: streetsOf(counters, segments, groups),
        segments: segmentsOf(counters, segments),
        edges: edgesOf(counters),
      };
    }),
  };
}

export const memberSeed = (seed: number, member: number) => seed * 1009 + member;
export const branchSeed = (seed: number, forecast: number, member: number) => seed * 7919 + forecast * 101 + member;

// One simulation following the incident. Blocked streets are replaced as the agency learns of them.
export class ForecastMember {
  readonly sim: CrowdSim;
  private blocked = new Set<number>();

  constructor(ground: Ground, households: Household[], seed: number, params: CrowdParams = DEFAULT_CROWD) {
    this.sim = new CrowdSim(ground, households, seededRandom(seed), () => this.blocked, params);
  }

  setBlocked(blocked: Set<number>) {
    if (blocked.size === this.blocked.size && [...blocked].every((segment) => this.blocked.has(segment))) return;
    this.blocked = blocked;
    this.sim.refreshBlockages();
  }

  advanceTo(minute: number) {
    advance(this.sim, minute);
  }

  // The hour ahead from the present, on a fork, so the member itself stays at the present.
  branch(seed: number): Branch {
    return runBranch(this.sim.fork(seededRandom(seed)));
  }
}

// The whole ensemble in one thread. The runner spreads the same members over worker threads.
export class TrafficEnsemble {
  readonly members: ForecastMember[];
  private forecasts = 0;

  constructor(
    readonly ground: Ground,
    readonly households: Household[],
    size: number,
    private readonly seed: number,
    params: CrowdParams = DEFAULT_CROWD,
  ) {
    this.members = Array.from({ length: size }, (_, k) => new ForecastMember(ground, households, memberSeed(seed, k), params));
  }

  get minutes() {
    return Math.min(...this.members.map((member) => member.sim.minutes));
  }

  setBlocked(blocked: Set<number>) {
    for (const member of this.members) member.setBlocked(blocked);
  }

  advanceTo(minute: number) {
    for (const member of this.members) member.advanceTo(minute);
  }

  forecast(): TrafficForecast {
    this.forecasts += 1;
    const branches = this.members.map((member, k) => member.branch(branchSeed(this.seed, this.forecasts, k)));
    return summarize(branches, this.ground.segments, this.minutes, this.households.length);
  }
}
