import { createProjection, ROAD_WIDTH, type InkMapData, type Point, type Road } from "../../data";
import type { RoadClosure, Scenario } from "../../scenario";
import type { HazardImpact } from "../types";

// Which streets the storm closes and when, where the barriers stand, and which homes no vehicle can
// reach. The scenario names closures by street class ("Arterials (Main St, ...)"), by street name, or
// by a drawn path; each becomes a rule, and every road and dispatcher edge gets the window it is shut.

// Streets a plough or a car would use. Service roads, tracks and paths have no closure record, so
// they are left to the snow.
export const MOST_STREET_CLASS = 4;

export type ClosureWindow = { closedAt: number; reopensAt: number };
export const NEVER_CLOSED: ClosureWindow = { closedAt: Infinity, reopensAt: Infinity };

export const isClosed = (window: ClosureWindow, minutes: number) => minutes >= window.closedAt && minutes < window.reopensAt;

type ClosureRule = { classes: number[]; names: string[]; path: Point[] | null; window: ClosureWindow };

const CLASS_WORDS: [RegExp, number[]][] = [
  [/expressway|motorway|freeway|interstate|trunk/i, [0]],
  [/arterial|primary|secondary|tertiary/i, [1, 2, 3]],
  [/side street|residential|local street|unclassified|minor street/i, [4]],
];

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bstreet\b/g, "st"],
  [/\bavenue\b/g, "ave"],
  [/\bboulevard\b/g, "blvd"],
  [/\broad\b/g, "rd"],
  [/\bdrive\b/g, "dr"],
  [/\bparkway\b/g, "pkwy"],
];

export function streetName(name: string) {
  const lower = ABBREVIATIONS.reduce((text, [word, short]) => text.replace(word, short), name.toLowerCase());
  return lower.replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// The words outside brackets say what closed; the bracket lists examples, which are not the whole set.
function ruleFor(closure: RoadClosure, toLocal: (point: { lat: number; lng: number }) => Point): ClosureRule {
  const headline = closure.road.replace(/\(.*\)/g, " ");
  const classes = CLASS_WORDS.flatMap(([words, roadClasses]) => (words.test(headline) ? roadClasses : []));
  const names = classes.length > 0 ? [] : headline.split(/,|\band\b/).map(streetName).filter(Boolean);
  return {
    classes,
    names,
    path: closure.path?.length ? closure.path.map(toLocal) : null,
    window: { closedAt: closure.closedAtMinutes, reopensAt: closure.reopensAtMinutes ?? Infinity },
  };
}

export function closureRules(scenario: Scenario | null, data: InkMapData): ClosureRule[] {
  if (scenario?.kind !== "blizzard") return [];
  const closures = (scenario.series as { roadClosures?: RoadClosure[] }).roadClosures ?? [];
  const { toLocal } = createProjection(data.origin);
  return closures.map((closure) => ruleFor(closure, toLocal));
}

// Which rules hold at a minute, as a short key: the state of every street changes only when it does.
export const closureStateKey = (rules: ClosureRule[], minutes: number) => rules.map((rule) => (isClosed(rule.window, minutes) ? "1" : "0")).join("");

function distanceToSegment([x, y]: Point, [ax, ay]: Point, [bx, by]: Point) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function distanceToPath(point: Point, path: Point[]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, distanceToSegment(point, path[i - 1], path[i]));
  return path.length === 1 ? Math.hypot(point[0] - path[0][0], point[1] - path[0][1]) : best;
}

const PATH_MATCH_METERS = 15;

// A road follows a drawn closure when most of its points lie along the path.
function followsPath(road: Road, path: Point[]) {
  const near = road.path.filter((point) => distanceToPath(point, path) <= PATH_MATCH_METERS).length;
  return near >= Math.max(1, road.path.length / 2);
}

function ruleCovers(rule: ClosureRule, road: Road) {
  if (road.tunnel) return false;
  if (rule.path) return road.roadClass <= MOST_STREET_CLASS + 1 && followsPath(road, rule.path);
  if (rule.classes.length > 0) return road.roadClass <= MOST_STREET_CLASS && rule.classes.includes(road.roadClass);
  return rule.names.length > 0 && rule.names.includes(streetName(road.name ?? ""));
}

// Two rules on one road join into the span from the earliest closing to the latest reopening.
function joined(a: ClosureWindow, b: ClosureWindow): ClosureWindow {
  if (a === NEVER_CLOSED) return b;
  return { closedAt: Math.min(a.closedAt, b.closedAt), reopensAt: Math.max(a.reopensAt, b.reopensAt) };
}

// The rules that cover each road, so a drawing can tell from closureStateKey alone which are shut.
export function roadRules(data: InkMapData, rules: ClosureRule[]): number[][] {
  return data.roads.map((road) => rules.flatMap((rule, index) => (ruleCovers(rule, road) ? [index] : [])));
}

export const closedUnder = (ruleIndices: number[], stateKey: string) => ruleIndices.some((index) => stateKey[index] === "1");

export function roadWindows(data: InkMapData, rules: ClosureRule[]): ClosureWindow[] {
  return data.roads.map((road) => rules.reduce((window, rule) => (ruleCovers(rule, road) ? joined(window, rule.window) : window), NEVER_CLOSED));
}

// ---- A grid of road points and segments, for nearest-road questions ----

type SegmentRef = { item: number; a: Point; b: Point };

class SegmentGrid {
  private cells = new Map<number, SegmentRef[]>();
  constructor(private cell: number) {}

  private key(col: number, row: number) {
    return col * 1_048_576 + row;
  }

  add(item: number, a: Point, b: Point) {
    const c0 = Math.floor(Math.min(a[0], b[0]) / this.cell);
    const c1 = Math.floor(Math.max(a[0], b[0]) / this.cell);
    const r0 = Math.floor(Math.min(a[1], b[1]) / this.cell);
    const r1 = Math.floor(Math.max(a[1], b[1]) / this.cell);
    for (let col = c0; col <= c1; col++) {
      for (let row = r0; row <= r1; row++) {
        const key = this.key(col, row);
        const list = this.cells.get(key);
        if (list) list.push({ item, a, b });
        else this.cells.set(key, [{ item, a, b }]);
      }
    }
  }

  // The item with a segment nearest the point, searching outward ring by ring up to `within` metres.
  nearest(point: Point, within: number): number {
    const col = Math.floor(point[0] / this.cell);
    const row = Math.floor(point[1] / this.cell);
    let best = -1;
    let bestDistance = within;
    const visit = (ref: SegmentRef) => {
      const distance = distanceToSegment(point, ref.a, ref.b);
      if (distance < bestDistance) [best, bestDistance] = [ref.item, distance];
    };
    for (let ring = 0; ring <= Math.ceil(within / this.cell); ring++) {
      if (best >= 0 && (ring - 1) * this.cell > bestDistance) break;
      this.visitRing(col, row, ring, visit);
    }
    return best;
  }

  // Every item with a segment within `radius` metres of the point.
  around(point: Point, radius: number): Set<number> {
    const col = Math.floor(point[0] / this.cell);
    const row = Math.floor(point[1] / this.cell);
    const found = new Set<number>();
    const visit = (ref: SegmentRef) => {
      if (distanceToSegment(point, ref.a, ref.b) <= radius) found.add(ref.item);
    };
    for (let ring = 0; ring <= Math.ceil(radius / this.cell); ring++) this.visitRing(col, row, ring, visit);
    return found;
  }

  private visitCell(col: number, row: number, visit: (ref: SegmentRef) => void) {
    const list = this.cells.get(this.key(col, row));
    if (list) for (const ref of list) visit(ref);
  }

  // The cells on the square ring `ring` cells out from (col, row).
  private visitRing(col: number, row: number, ring: number, visit: (ref: SegmentRef) => void) {
    if (ring === 0) return this.visitCell(col, row, visit);
    for (let d = -ring; d <= ring; d++) {
      this.visitCell(col + d, row - ring, visit);
      this.visitCell(col + d, row + ring, visit);
    }
    for (let d = 1 - ring; d <= ring - 1; d++) {
      this.visitCell(col - ring, row + d, visit);
      this.visitCell(col + ring, row + d, visit);
    }
  }
}

export const isStreet = (road: Road) => !road.tunnel && road.roadClass <= MOST_STREET_CLASS && road.path.length >= 2;

function streetGrid(data: InkMapData) {
  const grid = new SegmentGrid(40);
  data.roads.forEach((road, index) => {
    if (!isStreet(road)) return;
    for (let i = 1; i < road.path.length; i++) grid.add(index, road.path[i - 1], road.path[i]);
  });
  return grid;
}

// ---- Barriers ----

// `window` is when the barrier's own street is shut; `crossing` when the street it opens onto is. A
// barrier stands only while its street is shut and the other is open: the edge of the open network.
export type Barrier = { at: Point; angle: number; width: number; window: ClosureWindow; crossing: ClosureWindow };

export const barrierStands = (barrier: Barrier, minutes: number) => isClosed(barrier.window, minutes) && !isClosed(barrier.crossing, minutes);

const MOST_BARRIERS = 4000;
const BARRIER_SPACING_METERS = 18;
const MEETS_METERS = 2.5;
const BARRIER_SETBACK_METERS = 3;

const classGroup = (roadClass: number) => (roadClass === 0 ? 0 : roadClass <= 3 ? 1 : 2);
const sameWindow = (a: ClosureWindow, b: ClosureWindow) => a.closedAt === b.closedAt && a.reopensAt === b.reopensAt;

// The point `distance` metres along a path from its start, and the direction the path runs there.
function alongPath(path: Point[], distance: number): { at: Point; angle: number } | null {
  let left = distance;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const length = Math.hypot(bx - ax, by - ay);
    if (length >= left && length > 0) return { at: [ax + ((bx - ax) * left) / length, ay + ((by - ay) * left) / length], angle: Math.atan2(by - ay, bx - ax) };
    left -= length;
  }
  return null;
}

const pathLength = (path: Point[]) => path.reduce((sum, point, i) => (i === 0 ? 0 : sum + Math.hypot(point[0] - path[i - 1][0], point[1] - path[i - 1][1])), 0);

type Mouth = { road: number; path: Point[]; crossing: number };

// A barrier stands where a closed street meets one of another kind that the storm treats
// differently: a side street at an arterial, a ramp at a surface street. Two side streets crossing
// get none, or a closed town would be nothing but barriers.
function mouths(data: InkMapData, windows: ClosureWindow[], grid: SegmentGrid): Mouth[] {
  const found: Mouth[] = [];
  const meets = (index: number, other: number) =>
    other !== index && classGroup(data.roads[other].roadClass) !== classGroup(data.roads[index].roadClass) && !sameWindow(windows[other], windows[index]);
  data.roads.forEach((road, index) => {
    if (!isStreet(road) || windows[index] === NEVER_CLOSED) return;
    for (const path of [road.path, [...road.path].reverse()]) {
      const crossing = [...grid.around(path[0], MEETS_METERS)].find((other) => meets(index, other));
      if (crossing !== undefined) found.push({ road: index, path, crossing });
    }
  });
  return found;
}

function barrierAt(data: InkMapData, windows: ClosureWindow[], mouth: Mouth): Barrier | null {
  const road = data.roads[mouth.road];
  const setback = ROAD_WIDTH[data.roads[mouth.crossing].roadClass] / 2 + BARRIER_SETBACK_METERS;
  if (pathLength(mouth.path) < setback * 2) return null;
  const place = alongPath(mouth.path, setback);
  return place && { at: place.at, angle: place.angle, width: ROAD_WIDTH[road.roadClass] * 0.9, window: windows[mouth.road], crossing: windows[mouth.crossing] };
}

export function closureBarriers(data: InkMapData, windows: ClosureWindow[]): Barrier[] {
  const grid = streetGrid(data);
  const placed: Barrier[] = [];
  const taken = new SegmentGrid(BARRIER_SPACING_METERS);
  for (const mouth of mouths(data, windows, grid)) {
    if (placed.length >= MOST_BARRIERS) break;
    const barrier = barrierAt(data, windows, mouth);
    if (!barrier || taken.nearest(barrier.at, BARRIER_SPACING_METERS) >= 0) continue;
    taken.add(placed.length, barrier.at, barrier.at);
    placed.push(barrier);
  }
  return placed;
}

// ---- Who the storm cuts off ----

type Link = { a: number; b: number; window: ClosureWindow; key: string | null };

export type Network = {
  nodeCount: number;
  links: Link[];
  // The link a vehicle would reach each building from, or -1 when no street is near.
  homeLink: Int32Array;
  // The component of each link with every street open: a home in a piece of the network that the
  // map's edge already cuts off is never blamed on the storm.
  clearComponent: Int32Array;
  clearMain: number;
};

const EDGE_MATCH_METERS = 20;
const HOME_REACH_METERS = 250;

function midpoint(shape: Point[]): Point {
  return alongPath(shape, pathLength(shape) / 2)?.at ?? shape[0];
}

// The dispatcher's edges, each shut when the street it runs along is shut.
function graphLinks(data: InkMapData, windows: ClosureWindow[], grid: SegmentGrid): Link[] {
  return data.graph.edges.map((edge) => {
    const road = edge.shape.length > 0 ? grid.nearest(midpoint(edge.shape), EDGE_MATCH_METERS) : -1;
    return { a: edge.u, b: edge.v, window: road >= 0 ? windows[road] : NEVER_CLOSED, key: edge.key };
  });
}

// Without a dispatcher graph, the drawn streets stand in: every street point is a node.
function streetLinks(data: InkMapData, windows: ClosureWindow[]) {
  const nodes = new Map<string, number>();
  const nodeAt = ([x, y]: Point) => {
    const key = `${Math.round(x * 2)},${Math.round(y * 2)}`;
    if (!nodes.has(key)) nodes.set(key, nodes.size);
    return nodes.get(key)!;
  };
  const links: Link[] = [];
  const shapes: Point[][] = [];
  data.roads.forEach((road, index) => {
    if (!isStreet(road)) return;
    for (let i = 1; i < road.path.length; i++) {
      links.push({ a: nodeAt(road.path[i - 1]), b: nodeAt(road.path[i]), window: windows[index], key: null });
      shapes.push([road.path[i - 1], road.path[i]]);
    }
  });
  return { links, shapes, nodeCount: nodes.size };
}

class Components {
  private parent: Int32Array;
  constructor(size: number) {
    this.parent = Int32Array.from({ length: size }, (_, i) => i);
  }
  find(node: number): number {
    let root = node;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[node] !== root) [this.parent[node], node] = [root, this.parent[node]];
    return root;
  }
  join(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

// Each link's component when only `open` links join nodes, and the component holding the most links.
function linkComponents(nodeCount: number, links: Link[], open: (link: Link) => boolean) {
  const components = new Components(nodeCount);
  for (const link of links) if (open(link)) components.join(link.a, link.b);
  const of = Int32Array.from(links, (link) => components.find(link.a));
  const counts = new Map<number, number>();
  links.forEach((link, i) => open(link) && counts.set(of[i], (counts.get(of[i]) ?? 0) + 1));
  let main = -1;
  for (const [root, count] of counts) if (main < 0 || count > (counts.get(main) ?? 0)) main = root;
  return { of, main };
}

export function buildNetwork(data: InkMapData, windows: ClosureWindow[]): Network {
  const streets = streetGrid(data);
  const fromGraph = data.graph.edges.length > 0;
  const fallback = fromGraph ? null : streetLinks(data, windows);
  const links = fromGraph ? graphLinks(data, windows, streets) : fallback!.links;
  const shapes = fromGraph ? data.graph.edges.map((edge) => edge.shape) : fallback!.shapes;
  const nodeCount = fromGraph ? data.graph.nodes.length : fallback!.nodeCount;
  const linkGrid = new SegmentGrid(50);
  shapes.forEach((shape, index) => {
    for (let i = 1; i < shape.length; i++) linkGrid.add(index, shape[i - 1], shape[i]);
  });
  const homeLink = Int32Array.from(data.buildings, (building) => linkGrid.nearest(building.center, HOME_REACH_METERS));
  const clear = linkComponents(nodeCount, links, () => true);
  return { nodeCount, links, homeLink, clearComponent: clear.of, clearMain: clear.main };
}

// Homes whose nearest drivable street is shut, or open but no longer joined to the rest of the town.
function cutOffHomes(network: Network, minutes: number) {
  const open = (link: Link) => !isClosed(link.window, minutes);
  if (network.links.every(open)) return [];
  const now = linkComponents(network.nodeCount, network.links, open);
  const reachable = network.links.map((link, i) => open(link) && now.of[i] === now.main);
  const homes: number[] = [];
  network.homeLink.forEach((link, building) => {
    if (link >= 0 && network.clearComponent[link] === network.clearMain && !reachable[link]) homes.push(building);
  });
  return homes;
}

export function impactAt(data: InkMapData, windows: ClosureWindow[], network: Network, minutes: number): HazardImpact {
  const roads = windows.flatMap((window, index) => (isClosed(window, minutes) && isStreet(data.roads[index]) ? [index] : []));
  const edges = network.links.flatMap((link) => (link.key !== null && isClosed(link.window, minutes) ? [link.key] : []));
  return { buildings: cutOffHomes(network, minutes), roads, edges };
}
