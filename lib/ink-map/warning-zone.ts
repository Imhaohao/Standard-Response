import type { Point } from "./data";
import { contains } from "./fire-field";
import { blockCorners } from "./street-blocks";
import { StreetNetwork, streetsBetweenCorners } from "./street-network";

// A warning zone drawn for the dispatcher around some points, such as the buildings a fire burns.
// It is a list of street corners: the same corners a dispatcher clicks, joined along the streets
// the same way, so it opens in the zone tool ready to check, change and save.

export type WarningZone = { corners: number[]; ring: Point[] };

const AROUND_DIRECTIONS = 8;
const AROUND_MARGINS_METERS = [60, 120, 240];
const CORNER_REACH_METERS = 150;

function centroid(points: Point[]): Point {
  return points.reduce<Point>((sum, [x, y]) => [sum[0] + x / points.length, sum[1] + y / points.length], [0, 0]);
}

// The corner nearest `target` that lies further out than `edge` along `direction` from `center`.
function cornerBeyond(network: StreetNetwork, target: Point, beyond: { center: Point; direction: Point; edge: number }) {
  let best = -1;
  let bestDistance = CORNER_REACH_METERS;
  for (const corner of network.corners) {
    const [x, y] = network.points[corner];
    const along = (x - beyond.center[0]) * beyond.direction[0] + (y - beyond.center[1]) * beyond.direction[1];
    const distance = Math.hypot(x - target[0], y - target[1]);
    if (along > beyond.edge && distance < bestDistance) [best, bestDistance] = [corner, distance];
  }
  return best;
}

// One street corner a margin past the points in each compass direction, counter-clockwise. Used
// where the points are not all inside closed blocks.
function cornersAround(network: StreetNetwork, points: Point[], margin: number) {
  const center = centroid(points);
  const picked = new Set<number>();
  for (let step = 0; step < AROUND_DIRECTIONS; step++) {
    const angle = (step / AROUND_DIRECTIONS) * 2 * Math.PI;
    const direction: Point = [Math.cos(angle), Math.sin(angle)];
    const edge = Math.max(...points.map(([x, y]) => (x - center[0]) * direction[0] + (y - center[1]) * direction[1]));
    const target: Point = [center[0] + direction[0] * (edge + margin), center[1] + direction[1] * (edge + margin)];
    const corner = cornerBeyond(network, target, { center, direction, edge });
    if (corner >= 0) picked.add(corner);
  }
  const bearing = (corner: number) => Math.atan2(network.points[corner][1] - center[1], network.points[corner][0] - center[0]);
  return [...picked].sort((a, b) => bearing(a) - bearing(b));
}

// The boundary the zone tool saves for these corners: the streets from each corner to the next, closing back to the first.
function routeThrough(network: StreetNetwork, corners: number[]) {
  return corners.flatMap((corner, i) => streetsBetweenCorners(network, corner, corners[(i + 1) % corners.length]));
}

// Whole blocks first, since their edges are the streets themselves; then rings of corners further
// and further out. The first whose saved boundary holds every point wins. Null if none does.
export function warningZoneAround(network: StreetNetwork, points: Point[]): WarningZone | null {
  if (points.length === 0) return null;
  const candidates = [() => blockCorners(network, points), ...AROUND_MARGINS_METERS.map((margin) => () => cornersAround(network, points, margin))];
  for (const candidate of candidates) {
    const corners = candidate();
    if (corners.length < 3) continue;
    const ring = routeThrough(network, corners);
    if (points.every(([x, y]) => contains(ring, x, y))) return { corners, ring };
  }
  return null;
}
