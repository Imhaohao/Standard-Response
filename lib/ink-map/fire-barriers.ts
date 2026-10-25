import { AREA_KIND, Area, Point, Road } from "./data";
import { contains } from "./fire-field";

// What lies between two buildings: the roads the gap crosses, whether it crosses a wash or open water,
// and what kind of open ground the middle of the gap is. Built from the same OSM roads and areas the map
// draws, so a rehearsal fire stops where the dispatcher can see why.

export type FireGround = { roads: Road[]; areas: Area[] };
export type Crossing = { water: boolean; widestRoad: number | null; ground: number | null };

const CELL_METERS = 60;
type Segment = { a: Point; b: Point; tag: number };

const cellKey = (col: number, row: number) => `${col},${row}`;

function cellsOver(a: Point, b: Point) {
  const keys: string[] = [];
  const [c0, c1] = [Math.floor(Math.min(a[0], b[0]) / CELL_METERS), Math.floor(Math.max(a[0], b[0]) / CELL_METERS)];
  const [r0, r1] = [Math.floor(Math.min(a[1], b[1]) / CELL_METERS), Math.floor(Math.max(a[1], b[1]) / CELL_METERS)];
  for (let col = c0; col <= c1; col++) for (let row = r0; row <= r1; row++) keys.push(cellKey(col, row));
  return keys;
}

function index<T>(items: { item: T; a: Point; b: Point }[]) {
  const cells = new Map<string, T[]>();
  for (const { item, a, b } of items) {
    for (const key of cellsOver(a, b)) {
      const cell = cells.get(key);
      if (cell) cell.push(item);
      else cells.set(key, [item]);
    }
  }
  return (a: Point, b: Point) => new Set(cellsOver(a, b).flatMap((key) => cells.get(key) ?? []));
}

const side = (o: Point, a: Point, b: Point) => Math.sign((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]));
const crosses = (p: Point, q: Point, s: Segment) => side(p, q, s.a) !== side(p, q, s.b) && side(s.a, s.b, p) !== side(s.a, s.b, q);

function edgesOf(path: Point[], tag: number, closed: boolean): Segment[] {
  const segments: Segment[] = [];
  for (let i = 1; i < path.length; i++) segments.push({ a: path[i - 1], b: path[i], tag });
  if (closed && path.length > 2) segments.push({ a: path[path.length - 1], b: path[0], tag });
  return segments;
}

function bounds(ring: Point[]): [Point, Point] {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

// Footpaths, tracks and tunnels are no barrier.
const BARRIER_ROAD_CLASSES = 6;

export function fireGround({ roads, areas }: FireGround) {
  const roadSegments = roads.filter((road) => road.roadClass < BARRIER_ROAD_CLASSES && !road.tunnel).flatMap((road) => edgesOf(road.path, road.roadClass, false));
  const waterEdges = areas.filter((area) => area.kind === AREA_KIND.water).flatMap((area) => edgesOf(area.ring, AREA_KIND.water, true));
  const roadsNear = index(roadSegments.map((segment) => ({ item: segment, a: segment.a, b: segment.b })));
  const waterNear = index(waterEdges.map((segment) => ({ item: segment, a: segment.a, b: segment.b })));
  // Smallest first, so a school inside a park reads as the school.
  const sorted = [...areas].map((area) => ({ area, box: bounds(area.ring) })).sort((p, q) => boxArea(p.box) - boxArea(q.box));
  const areasNear = index(sorted.map(({ area, box }) => ({ item: area, a: box[0], b: box[1] })));

  return (from: Point, to: Point): Crossing => {
    let widestRoad: number | null = null;
    for (const segment of roadsNear(from, to)) if (crosses(from, to, segment) && (widestRoad === null || segment.tag < widestRoad)) widestRoad = segment.tag;
    const water = [...waterNear(from, to)].some((segment) => crosses(from, to, segment));
    const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const ground = [...areasNear(middle, middle)].find((area) => contains(area.ring, middle[0], middle[1]))?.kind ?? null;
    return { water, widestRoad, ground };
  };
}

function boxArea([low, high]: [Point, Point]) {
  return (high[0] - low[0]) * (high[1] - low[1]);
}
