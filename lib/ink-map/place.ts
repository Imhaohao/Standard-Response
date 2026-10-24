import { InkMapData, Point } from "./data";

// Homes sit on coordinates; the map draws buildings. This index answers "which roof is this
// address under" so a request can light up the building it belongs to.
const CELL_METERS = 90;
const NEAREST_METERS = 45;

export type PlaceIndex = {
  cell: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  buckets: number[][];
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function buildPlaceIndex(data: InkMapData): PlaceIndex {
  const { x0, y0, x1, y1 } = data.detail;
  const cols = Math.max(1, Math.ceil((x1 - x0) / CELL_METERS));
  const rows = Math.max(1, Math.ceil((y1 - y0) / CELL_METERS));
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const column = (x: number) => clamp(Math.floor((x - x0) / CELL_METERS), 0, cols - 1);
  const row = (y: number) => clamp(Math.floor((y - y0) / CELL_METERS), 0, rows - 1);

  data.buildings.forEach((building, id) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of building.ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let cy = row(minY); cy <= row(maxY); cy++) {
      for (let cx = column(minX); cx <= column(maxX); cx++) buckets[cy * cols + cx].push(id);
    }
  });

  return { cell: CELL_METERS, x0, y0, cols, rows, buckets };
}

function containsPoint(ring: Point[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringArea(ring: Point[]) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(sum / 2);
}

// The building whose footprint holds the point, preferring the smallest (a shed inside a lot
// should not win over the house). Falls back to the nearest roof, because simulated homes sit
// on a synthetic street grid rather than on real footprints.
export function buildingForPoint(index: PlaceIndex, data: InkMapData, [x, y]: Point): number | null {
  const cx = clamp(Math.floor((x - index.x0) / index.cell), 0, index.cols - 1);
  const cy = clamp(Math.floor((y - index.y0) / index.cell), 0, index.rows - 1);
  const candidates = index.buckets[cy * index.cols + cx];

  let best: number | null = null;
  let bestArea = Infinity;
  for (const id of candidates) {
    const building = data.buildings[id];
    if (ringArea(building.ring) >= bestArea) continue;
    if (!containsPoint(building.ring, x, y)) continue;
    best = id;
    bestArea = ringArea(building.ring);
  }
  if (best !== null) return best;

  let nearest: number | null = null;
  let nearestDistance = NEAREST_METERS;
  for (const id of candidates) {
    const [bx, by] = data.buildings[id].center;
    const distance = Math.hypot(bx - x, by - y);
    if (distance < nearestDistance) {
      nearest = id;
      nearestDistance = distance;
    }
  }
  return nearest;
}
