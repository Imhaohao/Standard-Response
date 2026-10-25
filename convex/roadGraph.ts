import graphFile from "../data/roads/altadena.json";
import { metersBetween, Point } from "./model";

// The west Altadena drive network from OpenStreetMap (dispatch/build_graph.py writes the file).
// Free-flow travel times unless an EdgeTime says otherwise (convex/traffic.ts slows them by the
// forecast evacuation traffic); closures remove edges. Dijkstra on ~1,850 nodes takes about a millisecond.

type EdgeRecord = {
  u: number;
  v: number;
  key: string;
  meters: number;
  seconds: number;
  // OpenStreetMap's lane count for the whole street, both directions together; 1 when unknown.
  lanes: number;
  name: string;
  geometry: number[][] | null;
};

type GraphFile = { nodes: number[][]; osmIds: string[]; edges: EdgeRecord[] };

const graph = graphFile as unknown as GraphFile;
export const NODE_COUNT = graph.nodes.length;
export const EDGES = graph.edges;

const outgoing: number[][] = Array.from({ length: NODE_COUNT }, () => []);
const edgeByKey = new Map<string, number>();
const edgesBetween = new Map<string, number[]>();
for (const [index, edge] of EDGES.entries()) {
  outgoing[edge.u].push(index);
  edgeByKey.set(edge.key, index);
  const pair = `${edge.u}-${edge.v}`;
  edgesBetween.set(pair, [...(edgesBetween.get(pair) ?? []), index]);
}

export function edgeIndexOf(key: string) {
  return edgeByKey.get(key);
}

// Seconds to drive an edge entered `at` seconds after setting out.
export type EdgeTime = (edgeIndex: number, at: number) => number;
export const freeFlow: EdgeTime = (edgeIndex) => EDGES[edgeIndex].seconds;

export function nodePoint(node: number): Point {
  const [lat, lng] = graph.nodes[node];
  return { lat, lng };
}

export function nearestNode(point: Point) {
  let best = 0;
  let bestMeters = Infinity;
  for (let node = 0; node < NODE_COUNT; node++) {
    const meters = metersBetween(point, nodePoint(node));
    if (meters < bestMeters) {
      best = node;
      bestMeters = meters;
    }
  }
  return best;
}

class MinHeap {
  private items: [number, number][] = [];

  get size() {
    return this.items.length;
  }

  push(item: [number, number]) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent][0] <= this.items[i][0]) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown();
    }
    return top;
  }

  private siftDown() {
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < this.items.length && this.items[left][0] < this.items[smallest][0]) smallest = left;
      if (right < this.items.length && this.items[right][0] < this.items[smallest][0]) smallest = right;
      if (smallest === i) return;
      [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
      i = smallest;
    }
  }
}

export type ShortestPaths = { seconds: Float64Array; viaEdge: Int32Array };

// Seconds from setting out at `source`. With a time-dependent EdgeTime each edge is priced at the
// time the drive reaches it; that is still exact Dijkstra as long as leaving later never arrives
// sooner, which convex/traffic.ts guarantees.
export function shortestPathsFrom(source: number, closed: ReadonlySet<number>, edgeTime: EdgeTime = freeFlow): ShortestPaths {
  const seconds = new Float64Array(NODE_COUNT).fill(Infinity);
  const viaEdge = new Int32Array(NODE_COUNT).fill(-1);
  seconds[source] = 0;
  const heap = new MinHeap();
  heap.push([0, source]);
  while (heap.size > 0) {
    const [time, node] = heap.pop();
    if (time > seconds[node]) continue;
    for (const edgeIndex of outgoing[node]) {
      if (closed.has(edgeIndex)) continue;
      const edge = EDGES[edgeIndex];
      const arrival = time + edgeTime(edgeIndex, time);
      if (arrival >= seconds[edge.v]) continue;
      seconds[edge.v] = arrival;
      viaEdge[edge.v] = edgeIndex;
      heap.push([arrival, edge.v]);
    }
  }
  return { seconds, viaEdge };
}

export function edgePath(paths: ShortestPaths, target: number): number[] | null {
  if (!Number.isFinite(paths.seconds[target])) return null;
  const edges: number[] = [];
  for (let node = target; paths.viaEdge[node] !== -1; node = EDGES[paths.viaEdge[node]].u) {
    edges.push(paths.viaEdge[node]);
  }
  return edges.reverse();
}

// Points along each edge with the seconds it takes to drive each piece, for moving a vehicle.
export function legsFor(edges: number[], edgeTime: EdgeTime = freeFlow) {
  const points: Point[] = [];
  const legSeconds: number[] = [];
  let clock = 0;
  for (const edgeIndex of edges) {
    const seconds = edgeTime(edgeIndex, clock);
    clock += seconds;
    const edge = EDGES[edgeIndex];
    const shape = edge.geometry?.map(([lat, lng]) => ({ lat, lng })) ?? [nodePoint(edge.u), nodePoint(edge.v)];
    if (points.length === 0) points.push(shape[0]);
    const pieces = shape.slice(1).map((p, i) => metersBetween(shape[i], p));
    const total = pieces.reduce((sum, m) => sum + m, 0) || 1;
    for (const [i, meters] of pieces.entries()) {
      points.push(shape[i + 1]);
      legSeconds.push((seconds * meters) / total);
    }
  }
  return { points, legSeconds };
}

// Closing a street segment closes both directions of it.
function withReverse(edgeIndex: number) {
  const edge = EDGES[edgeIndex];
  return [edgeIndex, ...(edgesBetween.get(`${edge.v}-${edge.u}`) ?? [])];
}

const ALONG_ROAD_METERS = 35;

function metersToSegment(p: Point, a: Point, b: Point) {
  const metersPerDegLng = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const toXY = (q: Point) => ({ x: (q.lng - a.lng) * metersPerDegLng, y: (q.lat - a.lat) * 111_320 });
  const [pp, bb] = [toXY(p), toXY(b)];
  const lengthSquared = bb.x * bb.x + bb.y * bb.y;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (pp.x * bb.x + pp.y * bb.y) / lengthSquared));
  return Math.hypot(pp.x - t * bb.x, pp.y - t * bb.y);
}

function metersToPath(p: Point, path: Point[]) {
  if (path.length === 1) return metersBetween(p, path[0]);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, metersToSegment(p, path[i - 1], path[i]));
  return best;
}

function cross(o: Point, a: Point, b: Point) {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function pathCrossesEdge(path: Point[], edge: EdgeRecord) {
  const [u, v] = [nodePoint(edge.u), nodePoint(edge.v)];
  for (let i = 1; i < path.length; i++) if (segmentsCross(path[i - 1], path[i], u, v)) return true;
  return false;
}

function edgeLiesAlongPath(path: Point[], edge: EdgeRecord) {
  return metersToPath(nodePoint(edge.u), path) < ALONG_ROAD_METERS && metersToPath(nodePoint(edge.v), path) < ALONG_ROAD_METERS;
}

// A closure drawn along a road closes the segments it runs along. One drawn across roads, like a
// fire line, closes every segment it cuts. Side streets that merely touch a closed road stay open.
function edgesForPath(path: Point[]) {
  const along = [...EDGES.keys()].filter((index) => edgeLiesAlongPath(path, EDGES[index]));
  if (along.length > 0) return along;
  return [...EDGES.keys()].filter((index) => pathCrossesEdge(path, EDGES[index]));
}

export function closedEdgesFor(closure: { edgeKey?: string; path: Point[] }) {
  const named = closure.edgeKey !== undefined ? edgeByKey.get(closure.edgeKey) : undefined;
  const direct = named !== undefined ? [named] : edgesForPath(closure.path);
  return [...new Set(direct.flatMap(withReverse))];
}

// Only the segments a reported closure runs along, both directions: never the ones it merely crosses.
// An outside feed gives a closure as its two ends, so the straight line between them can cut across
// streets that are open. A single point closes the segments passing within reach of it.
export function edgesRunningAlong(path: Point[]) {
  const lies = (edge: EdgeRecord) =>
    path.length === 1 ? metersToSegment(path[0], nodePoint(edge.u), nodePoint(edge.v)) < ALONG_ROAD_METERS : edgeLiesAlongPath(path, edge);
  const along = [...EDGES.keys()].filter((index) => lies(EDGES[index]));
  return [...new Set(along.flatMap(withReverse))];
}

export function edgeKeysOf(edges: number[]) {
  return edges.map((index) => EDGES[index].key);
}

export function closedEdgeSet(closures: { edgeKeys?: string[] }[]) {
  const closed = new Set<number>();
  for (const closure of closures) {
    for (const key of closure.edgeKeys ?? []) {
      const index = edgeByKey.get(key);
      if (index !== undefined) closed.add(index);
    }
  }
  return closed;
}

export function streetNames(edges: number[]) {
  return [...new Set(edges.map((index) => EDGES[index].name).filter(Boolean))];
}
