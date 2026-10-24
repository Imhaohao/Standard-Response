import { BUILDING_KIND, Building, Point } from "./data";
import { buildFireField, contains, ScenarioFront } from "./fire-field";
import type { Hazard } from "./hazard";

// A rehearsal fire lit at one house, spread building to building over the real footprints. A
// burning building ignites a neighbor after a delay that grows with the gap between them, with how
// well the neighbor resists fire, and against the wind. A building stops spreading fire once a fire
// crew is on it or once it has burned out, so a house fire that crews reach in time stays a house fire.
//
// The rates are rehearsal assumptions, not fitted to any fire. The crew arrival times follow NFPA
// 1710's targets: the first engine about 5 minutes after the call, the rest of a first alarm by 9.

// From ignition until a burning structure throws enough heat to light the one next to it.
const FLASHOVER_MINUTES = 10;
const MINUTES_PER_METER_OF_GAP = 1.2;
const RADIANT_REACH_METERS = 15;
const EMBER_REACH_METERS = 45;
const BURNOUT_MINUTES = 60;
const KNOCKDOWN_MINUTES = 20;
const STRUCTURES_PER_ENGINE = 2;
const FIRST_ENGINE_MINUTES = 6;
const OTHER_ENGINES_MINUTES = 10;
const LAST_MINUTES = 240;
const FRONT_EVERY_MINUTES = 10;
const FRONT_MARGIN_METERS = 12;
const CELL_METERS = RADIANT_REACH_METERS + EMBER_REACH_METERS;
// Santa Ana winds blow from the northeast, so with no scenario to read the wind from, the fire runs southwest.
const SOUTHWEST: Point = [-Math.SQRT1_2, -Math.SQRT1_2];

// How much longer than a typical wood-frame house each kind of building holds out against a burning
// neighbor. Sheds and carports go first; masonry shops, schools and hospitals hold out longest.
const RESISTANCE: Record<number, number> = {
  [BUILDING_KIND.outbuilding]: 0.6,
  [BUILDING_KIND.house]: 1,
  [BUILDING_KIND.apartments]: 1.3,
  [BUILDING_KIND.commercial]: 1.8,
  [BUILDING_KIND.civic]: 2,
};

// Homes built to California's wildfire code (Chapter 7A, from 2008) have Class A roofs, ember-resistant
// vents and noncombustible siding, so they take longer to catch and embers carry less far into them.
export type Construction = "older" | "hardened";
const HARDENED = { resistance: 1.7, emberReach: 0.5 };

export type Crews = 0 | 1 | 3;
export type FireResponse = { construction: Construction; engines: Crews };

// How many buildings burn, and the minute the last one is out, or null if it still spreads at the end of the run.
export type SimulatedFire = Hazard & { burned: number; outAt: number | null };

function centroid(ring: Point[]): Point {
  const sum = ring.reduce<Point>((total, [x, y]) => [total[0] + x, total[1] + y], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}

// The way the loaded scenario's fire travels overall, from its first front's middle to its last's.
export function downwindOf(fronts: ScenarioFront[] | undefined): Point {
  if (!fronts || fronts.length < 2) return SOUTHWEST;
  const [x0, y0] = centroid(fronts[0].ring);
  const [x1, y1] = centroid(fronts[fronts.length - 1].ring);
  const length = Math.hypot(x1 - x0, y1 - y0);
  return length < 1 ? SOUTHWEST : [(x1 - x0) / length, (y1 - y0) / length];
}

const cellKey = (x: number, y: number) => `${Math.floor(x / CELL_METERS)},${Math.floor(y / CELL_METERS)}`;

function spatialIndex(buildings: Building[]) {
  const cells = new Map<string, number[]>();
  buildings.forEach((building, index) => {
    const key = cellKey(building.center[0], building.center[1]);
    const cell = cells.get(key);
    if (cell) cell.push(index);
    else cells.set(key, [index]);
  });
  return (at: Point) => {
    const near: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) near.push(...(cells.get(cellKey(at[0] + dx * CELL_METERS, at[1] + dy * CELL_METERS)) ?? []));
    }
    return near;
  };
}

function footprintRadius(building: Building) {
  return Math.max(...building.ring.map(([x, y]) => Math.hypot(x - building.center[0], y - building.center[1])));
}

type Spread = { wind: Point; construction: Construction };

// Minutes for a burning building to light another, or null when it is out of reach.
function ignitionDelay(from: Building, to: Building, radii: Float32Array, indices: [number, number], spread: Spread) {
  const dx = to.center[0] - from.center[0];
  const dy = to.center[1] - from.center[1];
  const distance = Math.hypot(dx, dy);
  const gap = Math.max(0, distance - radii[indices[0]] - radii[indices[1]]);
  const downwind = distance > 0 ? (dx * spread.wind[0] + dy * spread.wind[1]) / distance : 0;
  const hardenedHome = spread.construction === "hardened" && to.kind !== BUILDING_KIND.commercial && to.kind !== BUILDING_KIND.civic;
  const emberReach = EMBER_REACH_METERS * (hardenedHome ? HARDENED.emberReach : 1);
  if (gap > RADIANT_REACH_METERS + emberReach * Math.max(0, downwind)) return null;
  const resistance = RESISTANCE[to.kind] * (hardenedHome ? HARDENED.resistance : 1);
  const wind = downwind >= 0 ? 1 / (1 + downwind) : 1 - downwind;
  return (FLASHOVER_MINUTES + gap * MINUTES_PER_METER_OF_GAP) * resistance * wind;
}

// Each engine works the burning buildings in the order they caught, a couple at a time.
function engineSlots(engines: Crews) {
  return Array.from({ length: engines * STRUCTURES_PER_ENGINE }, (_, slot) =>
    slot < STRUCTURES_PER_ENGINE ? FIRST_ENGINE_MINUTES : OTHER_ENGINES_MINUTES,
  );
}

function takeSlot(slots: number[], caught: number) {
  if (slots.length === 0) return Infinity;
  const next = slots.indexOf(Math.min(...slots));
  const attack = Math.max(caught, slots[next]);
  slots[next] = attack + KNOCKDOWN_MINUTES;
  return attack;
}

// The building that catches next among those not yet burning, or -1 when the fire has stopped.
function nextToCatch(pending: Map<number, number>) {
  let next = -1;
  let earliest = LAST_MINUTES;
  for (const [index, minute] of pending) {
    if (minute <= earliest) [next, earliest] = [index, minute];
  }
  return next;
}

type Search = { buildings: Building[]; radii: Float32Array; pending: Map<number, number>; burning: Map<number, number>; spread: Spread };

// A building lights every neighbor it can reach before a crew is on it or it burns out.
function spreadFrom(search: Search, from: number, stops: number, neighbors: number[]) {
  const start = search.burning.get(from)!;
  for (const to of neighbors) {
    if (search.burning.has(to)) continue;
    const delay = ignitionDelay(search.buildings[from], search.buildings[to], search.radii, [from, to], search.spread);
    if (delay === null || start + delay >= stops) continue;
    if (start + delay < (search.pending.get(to) ?? Infinity)) search.pending.set(to, start + delay);
  }
}

// The minute each building catches, earliest first, by a shortest-path search over buildings.
function ignitionMinutes(buildings: Building[], first: number, spread: Spread, engines: Crews) {
  const nearby = spatialIndex(buildings);
  const search: Search = { buildings, radii: Float32Array.from(buildings, footprintRadius), pending: new Map([[first, 0]]), burning: new Map(), spread };
  const slots = engineSlots(engines);
  let outAt = 0;
  for (let current = nextToCatch(search.pending); current >= 0; current = nextToCatch(search.pending)) {
    const start = search.pending.get(current)!;
    search.pending.delete(current);
    search.burning.set(current, start);
    const attack = takeSlot(slots, start);
    outAt = Math.max(outAt, Math.min(start + BURNOUT_MINUTES, attack + KNOCKDOWN_MINUTES));
    spreadFrom(search, current, Math.min(start + BURNOUT_MINUTES, attack), nearby(buildings[current].center));
  }
  const ignited = [...search.burning].map(([index, minute]) => ({ building: buildings[index], minute }));
  return { ignited, outAt: search.pending.size > 0 ? null : outAt };
}

function cross(o: Point, a: Point, b: Point) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

// The smallest convex ring around the points (Andrew's monotone chain), counter-clockwise.
function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (input: Point[]) => {
    const chain: Point[] = [];
    for (const point of input) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    return chain.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

// The burned ground at one minute: the hull of every burning footprint, with a margin around each.
function frontAround(burning: Building[], minutes: number): ScenarioFront {
  const corners = burning.flatMap((building) =>
    building.ring.flatMap(([x, y]): Point[] => [
      [x - FRONT_MARGIN_METERS, y],
      [x + FRONT_MARGIN_METERS, y],
      [x, y - FRONT_MARGIN_METERS],
      [x, y + FRONT_MARGIN_METERS],
    ]),
  );
  return { minutes, ring: convexHull(corners) };
}

// One front every few minutes until the last building is out, so the clock runs as long as the fire does.
function frontsOf(ignited: { building: Building; minute: number }[], until: number) {
  const fronts: ScenarioFront[] = [];
  for (let minutes = 0; minutes < until + FRONT_EVERY_MINUTES; minutes += FRONT_EVERY_MINUTES) {
    fronts.push(frontAround(ignited.filter(({ minute }) => minute <= minutes).map(({ building }) => building), minutes));
  }
  return fronts;
}

function nearestBuilding(buildings: Building[], at: Point) {
  let best = -1;
  let bestDistance = Infinity;
  buildings.forEach((building, index) => {
    const distance = contains(building.ring, at[0], at[1]) ? 0 : Math.hypot(building.center[0] - at[0], building.center[1] - at[1]);
    if (distance < bestDistance) [best, bestDistance] = [index, distance];
  });
  return best;
}

const ENGINE_WORDS: Record<Crews, string> = { 0: "no fire crews", 1: "one engine", 3: "three engines" };

export function ignitionHazard(buildings: Building[], ignition: Point, wind: Point, response: FireResponse): SimulatedFire | null {
  const first = nearestBuilding(buildings, ignition);
  if (first < 0) return null;
  const { ignited, outAt } = ignitionMinutes(buildings, first, { wind, construction: response.construction }, response.engines);
  const fronts = frontsOf(ignited, Math.min(outAt ?? LAST_MINUTES, LAST_MINUTES));
  return {
    field: buildFireField(fronts),
    label: "Simulated fire, not a forecast",
    basis: `Building to building, ${response.construction === "hardened" ? "wildfire-code" : "older"} homes, ${ENGINE_WORDS[response.engines]}`,
    burned: ignited.length,
    outAt,
  };
}
