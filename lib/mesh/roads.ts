import { EDGES, nodePoint } from "../../convex/roadGraph";
import { metersBetween, Point } from "../../convex/model";

// Street segments as phones talk about them. The road graph has one directed edge per direction;
// a person reporting "Lincoln Ave is blocked here" means both, so reports name the undirected
// segment. Its key is the graph edge key with the two OSM node ids in ascending order.

export type Segment = {
  key: string;
  edges: number[];
  name: string;
  kph: number;
  lanes: number;
  meters: number;
  mid: Point;
  path: Point[];
};

type EdgeFields = { key: string; kph?: number; lanes?: number; name: string; meters: number; geometry: number[][] | null; u: number; v: number };

export function segmentKeyOf(edgeKey: string) {
  const [a, b, k] = edgeKey.split("-");
  if (k === undefined) return edgeKey;
  return Number(a) <= Number(b) ? `${a}-${b}-${k}` : `${b}-${a}-${k}`;
}

function shapeOf(edge: EdgeFields): Point[] {
  return edge.geometry?.map(([lat, lng]) => ({ lat, lng })) ?? [nodePoint(edge.u), nodePoint(edge.v)];
}

function midpoint(path: Point[]): Point {
  const pieces = path.slice(1).map((p, i) => metersBetween(path[i], p));
  let remaining = pieces.reduce((sum, m) => sum + m, 0) / 2;
  for (const [i, meters] of pieces.entries()) {
    if (remaining <= meters && meters > 0) {
      const t = remaining / meters;
      return { lat: path[i].lat + t * (path[i + 1].lat - path[i].lat), lng: path[i].lng + t * (path[i + 1].lng - path[i].lng) };
    }
    remaining -= meters;
  }
  return path[0];
}

function buildSegments() {
  const byKey = new Map<string, Segment>();
  for (const [index, raw] of EDGES.entries()) {
    const edge = raw as EdgeFields;
    const key = segmentKeyOf(edge.key);
    const existing = byKey.get(key);
    if (existing) {
      existing.edges.push(index);
      continue;
    }
    const path = shapeOf(edge);
    byKey.set(key, {
      key,
      edges: [index],
      name: edge.name,
      kph: edge.kph ?? (edge.meters / Math.max((raw as { seconds: number }).seconds, 1)) * 3.6,
      lanes: edge.lanes ?? 1,
      meters: edge.meters,
      mid: midpoint(path),
      path,
    });
  }
  return byKey;
}

export const SEGMENTS = buildSegments();
export const SEGMENT_LIST = [...SEGMENTS.values()];

function metersToSegmentLine(p: Point, a: Point, b: Point) {
  const perLng = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const bx = (b.lng - a.lng) * perLng;
  const by = (b.lat - a.lat) * 111_320;
  const px = (p.lng - a.lng) * perLng;
  const py = (p.lat - a.lat) * 111_320;
  const lengthSquared = bx * bx + by * by;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));
  return Math.hypot(px - t * bx, py - t * by);
}

export function metersToSegment(p: Point, segment: Segment) {
  let best = Infinity;
  for (let i = 1; i < segment.path.length; i++) best = Math.min(best, metersToSegmentLine(p, segment.path[i - 1], segment.path[i]));
  return best;
}

// The street segment a tap on the map means, if one is close enough.
export function nearestSegment(p: Point, withinMeters = 60): Segment | null {
  let best: Segment | null = null;
  let bestMeters = withinMeters;
  for (const segment of SEGMENT_LIST) {
    if (metersBetween(p, segment.mid) > segment.meters + withinMeters) continue;
    const meters = metersToSegment(p, segment);
    if (meters < bestMeters) {
      best = segment;
      bestMeters = meters;
    }
  }
  return best;
}
