import { EDGES, nodePoint } from "../../convex/roadGraph";
import type { Point } from "../../convex/model";
import { arrivalAt, NEVER_BURNS, ScenarioFront, ScenarioGeoJson, scenarioFronts } from "../ink-map/fire-field";
import { Segment, SEGMENT_LIST } from "../mesh/roads";

// The ground the crowd model runs on: a square grid in metres east and north of the middle of
// the road network, the speed a car can drive on each cell, which street segments cover it, and
// when the fire scenario reaches it.

const METERS_PER_DEG_LAT = 110_574;

function networkBounds() {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const edge of EDGES) {
    for (const node of [edge.u, edge.v]) {
      const { lat, lng } = nodePoint(node);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    }
  }
  return { south, north, west, east };
}

export const BOUNDS = networkBounds();
const ORIGIN = { lat: (BOUNDS.south + BOUNDS.north) / 2, lng: (BOUNDS.west + BOUNDS.east) / 2 };
const METERS_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const toXY = (p: Point): [number, number] => [(p.lng - ORIGIN.lng) * METERS_PER_DEG_LNG, (p.lat - ORIGIN.lat) * METERS_PER_DEG_LAT];
export const toLatLng = (x: number, y: number): Point => ({ lat: ORIGIN.lat + y / METERS_PER_DEG_LAT, lng: ORIGIN.lng + x / METERS_PER_DEG_LNG });

// Off-road cells are driveways, lots and yards: passable, but slow enough that routes keep to streets.
export const OFF_ROAD_SPEED = 1.2;
const MIN_ROAD_SPEED = 4;

export type Ground = {
  cell: number;
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  // Free-flow speed in m/s.
  speed: Float32Array;
  // Indices into SEGMENT_LIST covering each cell (empty for off-road).
  segmentsAt: Int32Array[];
  // Minutes after the warning when the scenario fire reaches each cell.
  fireMinutes: Float32Array;
  segments: Segment[];
};

export function cellIndex(ground: Ground, x: number, y: number) {
  const col = Math.floor((x - ground.x0) / ground.cell);
  const row = Math.floor((y - ground.y0) / ground.cell);
  if (col < 0 || row < 0 || col >= ground.cols || row >= ground.rows) return -1;
  return row * ground.cols + col;
}

export const cellCenter = (ground: Ground, index: number): [number, number] => [
  ground.x0 + ((index % ground.cols) + 0.5) * ground.cell,
  ground.y0 + (Math.floor(index / ground.cols) + 0.5) * ground.cell,
];

function rasterizeSegment(ground: Ground, segmentIndex: number, covered: Set<number>[]) {
  const segment = ground.segments[segmentIndex];
  const speed = Math.max(segment.kph / 3.6, MIN_ROAD_SPEED);
  const points = segment.path.map(toXY);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (ground.cell / 3)));
    for (let s = 0; s <= steps; s++) {
      const index = cellIndex(ground, ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
      if (index < 0) continue;
      ground.speed[index] = Math.max(ground.speed[index], speed);
      covered[index].add(segmentIndex);
    }
  }
}

export function buildGround(cell: number, scenario: ScenarioGeoJson | null): Ground {
  const [west, south] = toXY({ lat: BOUNDS.south, lng: BOUNDS.west });
  const [east, north] = toXY({ lat: BOUNDS.north, lng: BOUNDS.east });
  const pad = cell * 2;
  const x0 = west - pad;
  const y0 = south - pad;
  const cols = Math.ceil((east - west + 2 * pad) / cell);
  const rows = Math.ceil((north - south + 2 * pad) / cell);
  const ground: Ground = {
    cell,
    cols,
    rows,
    x0,
    y0,
    speed: new Float32Array(cols * rows).fill(OFF_ROAD_SPEED),
    segmentsAt: [],
    fireMinutes: new Float32Array(cols * rows).fill(NEVER_BURNS),
    segments: SEGMENT_LIST,
  };
  const covered = Array.from({ length: cols * rows }, () => new Set<number>());
  for (let i = 0; i < ground.segments.length; i++) rasterizeSegment(ground, i, covered);
  ground.segmentsAt = covered.map((set) => Int32Array.from(set));
  if (scenario?.features?.length) fillFire(ground, scenarioFronts(scenario, (p) => toXY(p)));
  return ground;
}

function fillFire(ground: Ground, fronts: ScenarioFront[]) {
  const last = fronts[fronts.length - 1].ring;
  const xs = last.map((p) => p[0]);
  const ys = last.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs) - 400, Math.max(...xs) + 400, Math.min(...ys) - 400, Math.max(...ys) + 400];
  for (let index = 0; index < ground.fireMinutes.length; index++) {
    const [x, y] = cellCenter(ground, index);
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    ground.fireMinutes[index] = arrivalAt(fronts, x, y);
  }
}

export function fireMinutesAt(ground: Ground, x: number, y: number) {
  const index = cellIndex(ground, x, y);
  return index < 0 ? NEVER_BURNS : ground.fireMinutes[index];
}
