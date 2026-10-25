import { AREA_KIND, BUILDING_KIND, Building, Point } from "./data";
import { Crossing, FireGround, fireGround } from "./fire-barriers";
import { buildFireField, contains, ScenarioFront } from "./fire-field";
import type { Hazard } from "./hazard";
import { seededRandom, Wind, windWalk } from "./wind-walk";

// A rehearsal fire lit at one house, spread building to building over the real footprints. A
// burning building ignites a neighbor after a delay that grows with the gap between them, with how
// well the neighbor resists fire, against the wind, and with what lies in the gap: a wide road or a
// schoolyard holds it, a wash stops it unless a strong wind carries embers over. The wind shifts and
// gusts on a seeded walk around the scenario's direction, and a burning building can throw embers far
// downwind to start a spot fire. Some buildings never catch, so homes stand unburned inside the burn.
// A building stops spreading fire once a fire crew is on it or once it has burned out, so a house fire
// that crews reach in time stays a house fire.
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
// Burned ground drawn around each burned footprint, narrow enough that a home left standing shows.
const FOOTPRINT_MARGIN_METERS = 6;
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

// The chance a building never catches at all: masonry shops and civic buildings often come through.
const NEVER_IGNITES: Record<number, number> = {
  [BUILDING_KIND.outbuilding]: 0,
  [BUILDING_KIND.house]: 0.03,
  [BUILDING_KIND.apartments]: 0.05,
  [BUILDING_KIND.commercial]: 0.3,
  [BUILDING_KIND.civic]: 0.4,
};

// How many times longer fire takes to cross a road, by road class from freeway to service lane.
const ROAD_CROSSING = [2.4, 2, 1.8, 1.6, 1.35, 1.15];
// How many times longer it takes across open ground: turf, pavement and fields carry little fuel; brush carries more.
const OPEN_GROUND: Record<number, number> = {
  [AREA_KIND.park]: 1.8,
  [AREA_KIND.grass]: 1.3,
  [AREA_KIND.school]: 1.8,
  [AREA_KIND.parking]: 2.5,
  [AREA_KIND.cemetery]: 2,
  [AREA_KIND.golf]: 2.2,
  [AREA_KIND.pitch]: 2.2,
  [AREA_KIND.wild]: 0.6,
};
// Only embers in a strong wind blowing across it carry fire over a wash, and they take longer.
const WASH_CROSSING = { strength: 1.2, downwind: 0.6, slower: 2 };

// Spot fires: a fully involved building in a strong wind can loft embers well past its neighbors.
const SPOT_FIRE = { chance: 0.12, minStrength: 0.9, nearMeters: 60, farMeters: 200, swayDegrees: 15, landingMeters: 20, delayMinutes: [4, 14] as const };

// Homes built to California's wildfire code (Chapter 7A, from 2008) have Class A roofs, ember-resistant
// vents and noncombustible siding, so they take longer to catch, embers carry less far into them, and
// more of them never catch.
export type Construction = "older" | "hardened";
const HARDENED = { resistance: 1.7, emberReach: 0.5, neverIgnites: 0.35 };

export type Crews = 0 | 1 | 3;
export type FireResponse = { construction: Construction; engines: Crews };

// Where each burned building stands, and the minute the last one is out, or null if it still spreads at the end of the run.
export type SimulatedFire = Hazard & { burnedAt: Point[]; outAt: number | null };

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

type Spread = { wind: (minute: number) => Wind; construction: Construction; crossing: ((from: Point, to: Point) => Crossing) | null; seed: number };

const isHardenedHome = (building: Building, construction: Construction) =>
  construction === "hardened" && building.kind !== BUILDING_KIND.commercial && building.kind !== BUILDING_KIND.civic;

// One seeded draw per building and purpose, so the same fire makes the same choices every time.
const draw = (seed: number, building: Building, purpose: number) => seededRandom(Math.imul(seed, 31) ^ Math.imul(building.id + 1, 2654435761) ^ purpose)();

function neverIgnites(building: Building, spread: Spread) {
  const chance = isHardenedHome(building, spread.construction) ? HARDENED.neverIgnites : (NEVER_IGNITES[building.kind] ?? 0);
  return draw(spread.seed, building, 1) < chance;
}

// How many times longer the gap takes to cross because of what lies in it, or null when nothing but
// embers in a strong wind could cross it and the wind isn't there.
function barrierFactor(crossing: Crossing | null, wind: Wind, downwind: number) {
  if (!crossing) return 1;
  if (crossing.water && (wind.strength < WASH_CROSSING.strength || downwind < WASH_CROSSING.downwind)) return null;
  const road = crossing.widestRoad === null ? 1 : (ROAD_CROSSING[crossing.widestRoad] ?? 1);
  const ground = crossing.ground === null ? 1 : (OPEN_GROUND[crossing.ground] ?? 1);
  return road * ground * (crossing.water ? WASH_CROSSING.slower : 1);
}

// Minutes for a burning building to light another, or null when it is out of reach.
function ignitionDelay(from: Building, to: Building, gap: number, spread: Spread, wind: Wind) {
  const dx = to.center[0] - from.center[0];
  const dy = to.center[1] - from.center[1];
  const distance = Math.hypot(dx, dy);
  const downwind = distance > 0 ? (dx * wind.direction[0] + dy * wind.direction[1]) / distance : 0;
  const hardenedHome = isHardenedHome(to, spread.construction);
  const emberReach = EMBER_REACH_METERS * wind.strength * (hardenedHome ? HARDENED.emberReach : 1);
  if (gap > RADIANT_REACH_METERS + emberReach * Math.max(0, downwind)) return null;
  const barrier = barrierFactor(spread.crossing?.(from.center, to.center) ?? null, wind, downwind);
  if (barrier === null) return null;
  const resistance = RESISTANCE[to.kind] * (hardenedHome ? HARDENED.resistance : 1);
  const push = downwind * wind.strength;
  const windFactor = push >= 0 ? 1 / (1 + push) : 1 - push;
  return (FLASHOVER_MINUTES + gap * MINUTES_PER_METER_OF_GAP) * resistance * windFactor * barrier;
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

type Search = {
  buildings: Building[];
  radii: Float32Array;
  pending: Map<number, number>;
  burning: Map<number, number>;
  spread: Spread;
  nearby: (at: Point) => number[];
  standing: Map<number, boolean>;
};

// Whether a building never catches, drawn once and remembered.
function staysStanding(search: Search, index: number) {
  let standing = search.standing.get(index);
  if (standing === undefined) search.standing.set(index, (standing = neverIgnites(search.buildings[index], search.spread)));
  return standing;
}

function catchAt(search: Search, index: number, minute: number) {
  if (search.burning.has(index) || staysStanding(search, index)) return;
  if (minute < (search.pending.get(index) ?? Infinity)) search.pending.set(index, minute);
}

// A building lights every neighbor it can reach before a crew is on it or it burns out, under the wind
// blowing when it caught.
function spreadFrom(search: Search, from: number, stops: number) {
  const start = search.burning.get(from)!;
  const wind = search.spread.wind(start);
  const source = search.buildings[from];
  for (const to of search.nearby(source.center)) {
    if (to === from || search.burning.has(to)) continue;
    const target = search.buildings[to];
    const gap = Math.max(0, Math.hypot(target.center[0] - source.center[0], target.center[1] - source.center[1]) - search.radii[from] - search.radii[to]);
    const delay = ignitionDelay(source, target, gap, search.spread, wind);
    if (delay !== null && start + delay < stops) catchAt(search, to, start + delay);
  }
}

function nearestWithin(search: Search, at: Point, meters: number) {
  let best = -1;
  let bestDistance = meters;
  for (const index of search.nearby(at)) {
    const [x, y] = search.buildings[index].center;
    const distance = Math.hypot(x - at[0], y - at[1]);
    if (distance < bestDistance) [best, bestDistance] = [index, distance];
  }
  return best;
}

// Once fully involved, a building in a strong wind may loft an ember far downwind: a spot fire where it lands.
function throwEmber(search: Search, from: number, stops: number) {
  const lofted = search.burning.get(from)! + FLASHOVER_MINUTES;
  const wind = search.spread.wind(lofted);
  const source = search.buildings[from];
  const roll = (purpose: number) => draw(search.spread.seed, source, purpose);
  if (lofted >= stops || wind.strength < SPOT_FIRE.minStrength || roll(2) >= SPOT_FIRE.chance * wind.strength ** 2) return;
  const reach = (SPOT_FIRE.nearMeters + roll(3) * (SPOT_FIRE.farMeters - SPOT_FIRE.nearMeters)) * wind.strength;
  const sway = ((roll(4) - 0.5) * 2 * SPOT_FIRE.swayDegrees * Math.PI) / 180;
  const [dx, dy] = wind.direction;
  const heading: Point = [dx * Math.cos(sway) - dy * Math.sin(sway), dx * Math.sin(sway) + dy * Math.cos(sway)];
  const landing: Point = [source.center[0] + heading[0] * reach, source.center[1] + heading[1] * reach];
  const target = nearestWithin(search, landing, SPOT_FIRE.landingMeters);
  const [soonest, latest] = SPOT_FIRE.delayMinutes;
  if (target >= 0) catchAt(search, target, lofted + soonest + roll(5) * (latest - soonest));
}

// The minute each building catches, earliest first, by a shortest-path search over buildings.
function ignitionMinutes(buildings: Building[], first: number, spread: Spread, engines: Crews) {
  const search: Search = {
    buildings,
    radii: Float32Array.from(buildings, footprintRadius),
    pending: new Map([[first, 0]]),
    burning: new Map(),
    spread,
    nearby: spatialIndex(buildings),
    standing: new Map([[first, false]]),
  };
  const slots = engineSlots(engines);
  let outAt = 0;
  for (let current = nextToCatch(search.pending); current >= 0; current = nextToCatch(search.pending)) {
    const start = search.pending.get(current)!;
    search.pending.delete(current);
    search.burning.set(current, start);
    const attack = takeSlot(slots, start);
    outAt = Math.max(outAt, Math.min(start + BURNOUT_MINUTES, attack + KNOCKDOWN_MINUTES));
    const stops = Math.min(start + BURNOUT_MINUTES, attack);
    spreadFrom(search, current, stops);
    throwEmber(search, current, stops);
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

// A burned footprint grown by a margin, scaled about its middle.
function grown(building: Building, margin: number): Point[] {
  const radius = footprintRadius(building) || 1;
  const scale = (radius + margin) / radius;
  const [cx, cy] = building.center;
  return building.ring.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale]);
}

// The burned ground at one minute: each burned footprint with a narrow margin, so a home that never
// caught stands out inside the burn, and the hull of them all as the front's one outline.
function frontAround(burning: Building[], minutes: number): ScenarioFront {
  const corners = burning.flatMap((building) =>
    building.ring.flatMap(([x, y]): Point[] => [
      [x - FRONT_MARGIN_METERS, y],
      [x + FRONT_MARGIN_METERS, y],
      [x, y - FRONT_MARGIN_METERS],
      [x, y + FRONT_MARGIN_METERS],
    ]),
  );
  return { minutes, ring: convexHull(corners), polygons: burning.map((building) => [grown(building, FOOTPRINT_MARGIN_METERS)]) };
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

// `wind` is the way the fire is pushed on average; the walk swings and gusts around it. `ground` adds the
// roads, washes and open spaces between buildings; without it only the gaps between footprints count.
export function ignitionHazard(buildings: Building[], ignition: Point, wind: Point, response: FireResponse, ground?: FireGround): SimulatedFire | null {
  const first = nearestBuilding(buildings, ignition);
  if (first < 0) return null;
  const seed = buildings[first].id + 1;
  const spread: Spread = { wind: windWalk(wind, seed, LAST_MINUTES), construction: response.construction, crossing: ground ? fireGround(ground) : null, seed };
  const { ignited, outAt } = ignitionMinutes(buildings, first, spread, response.engines);
  const fronts = frontsOf(ignited, Math.min(outAt ?? LAST_MINUTES, LAST_MINUTES));
  return {
    field: buildFireField(fronts),
    label: "Simulated fire, not a forecast",
    basis: `Building to building, ${response.construction === "hardened" ? "wildfire-code" : "older"} homes, ${ENGINE_WORDS[response.engines]}`,
    burnedAt: ignited.map(({ building }) => building.center),
    outAt,
  };
}
