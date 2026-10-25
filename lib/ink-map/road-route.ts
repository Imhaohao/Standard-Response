import { GraphEdge, InkMapData, Point } from "./data";
import { blockedStreets, StreetNetwork, streetNetwork, streetRoute } from "./street-network";

// Routes and street picks for the rescue map. Routes run along every drawn street (see
// street-network.ts); closures name blocks of the drive graph, which the street picks return.

const blockedCache = new WeakMap<Set<string>, Set<string>>();

// Street links a set of closures blocks, worked out once per set of closures.
function blockedStreetsFor(network: StreetNetwork, data: InkMapData, closed: Set<string>) {
  let blocked = blockedCache.get(closed);
  if (!blocked) {
    blocked = blockedStreets(network, data, closed);
    blockedCache.set(closed, blocked);
  }
  return blocked;
}

// The way from one place to another along every drawn street, or null when closures cut it off.
export function streetDrive(data: InkMapData, from: Point, to: Point, closed: Set<string>): Point[] | null {
  const network = streetNetwork(data);
  return streetRoute(network, from, to, blockedStreetsFor(network, data, closed));
}

// A van's whole run: from where it is, through each stop in order, along every drawn street.
export function runRoute(data: InkMapData, start: Point, stops: Point[], closed: Set<string>): Point[] | null {
  const network = streetNetwork(data);
  const blocked = blockedStreetsFor(network, data, closed);
  const route: Point[] = [];
  let from = start;
  for (const stop of stops) {
    const leg = streetRoute(network, from, stop, blocked);
    if (!leg) return route.length > 1 ? route : null;
    route.push(...leg);
    from = stop;
  }
  return route;
}

function metersToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) {
  const [dx, dy] = [bx - ax, by - ay];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function metersToLine(point: Point, line: Point[]) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, metersToSegment(point, line[i - 1], line[i]));
  return best;
}

// The block of street (one edge of the drive graph, corner to corner) nearest a point.
export function nearestStreetBlock(data: InkMapData, point: Point, withinMeters: number): GraphEdge | null {
  let best: GraphEdge | null = null;
  let bestDistance = withinMeters;
  for (const edge of data.graph.edges) {
    const distance = metersToLine(point, edge.shape);
    if (distance < bestDistance) {
      best = edge;
      bestDistance = distance;
    }
  }
  return best;
}

// The street's name, from the drawn road that runs closest to the middle of a block.
export function streetName(data: InkMapData, shape: Point[]): string | null {
  const middle = shape[Math.floor(shape.length / 2)];
  let best: string | null = null;
  let bestDistance = 25;
  for (const road of data.roads) {
    if (!road.name) continue;
    const distance = metersToLine(middle, road.path);
    if (distance < bestDistance) {
      best = road.name;
      bestDistance = distance;
    }
  }
  return best;
}
