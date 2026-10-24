import { EDGES, NODE_COUNT, nodePoint } from "../../convex/roadGraph";
import { cellIndex, Ground, toXY } from "./grid";
import { NEVER_BURNS } from "../ink-map/fire-field";
import { segmentKeyOf } from "../mesh/roads";

// Route choice. Every driver holds a potential over the street graph: phi(n), the fastest drive
// from intersection n to safety, avoiding streets the fire has reached and the streets that driver
// believes are blocked, and crawling past streets the fire reaches within DANGER_MINUTES. At each
// intersection a driver takes the street that minimises (drive time + phi at its far end). The
// potential is one reverse Dijkstra from the safe intersections, under a millisecond on this graph,
// so each driver can route on exactly what it knows.

const DANGER_MINUTES = 15;
const DANGER_SLOWDOWN = 5;

const NEIGHBOR_OFFSETS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function isBurning(ground: Ground, index: number, minutes: number) {
  return ground.fireMinutes[index] <= minutes;
}

// Cells a car physically can't enter: a road cell whose every covering segment is blocked, and the
// off-road cells beside it, so a blocked street can't be bypassed through the yards next to it.
export function blockedMask(ground: Ground, blocked: ReadonlySet<number>) {
  const mask = new Uint8Array(ground.speed.length);
  if (blocked.size === 0) return mask;
  for (let i = 0; i < mask.length; i++) {
    const covering = ground.segmentsAt[i];
    if (covering.length > 0 && covering.every((segment) => blocked.has(segment))) mask[i] = 1;
  }
  const dilated = mask.slice();
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const col = i % ground.cols;
    const row = Math.floor(i / ground.cols);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= ground.cols || r >= ground.rows) continue;
      const j = r * ground.cols + c;
      if (ground.segmentsAt[j].length === 0) dilated[j] = 1;
    }
  }
  return dilated;
}

export class IndexHeap {
  private keys: Float64Array;
  private items: Int32Array;
  size = 0;
  // The key of the item `pop` returned last.
  lastKey = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.items = new Int32Array(capacity);
  }

  push(key: number, item: number) {
    if (this.size === this.keys.length) this.grow();
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.items[i] = item;
  }

  pop() {
    const item = this.items[0];
    this.lastKey = this.keys[0];
    const key = this.keys[--this.size];
    const last = this.items[this.size];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= key) break;
      this.keys[i] = this.keys[child];
      this.items[i] = this.items[child];
      i = child;
    }
    this.keys[i] = key;
    this.items[i] = last;
    return item;
  }

  private grow() {
    const keys = new Float64Array(this.keys.length * 2);
    const items = new Int32Array(this.items.length * 2);
    keys.set(this.keys);
    items.set(this.items);
    this.keys = keys;
    this.items = items;
  }
}

export type Potential = { minutes: number; phi: Float64Array };

export class RoadRouter {
  readonly nodeX = new Float64Array(NODE_COUNT);
  readonly nodeY = new Float64Array(NODE_COUNT);
  readonly safe = new Uint8Array(NODE_COUNT);
  readonly edgeSegment = new Int32Array(EDGES.length);
  readonly edgeFire = new Float64Array(EDGES.length);
  readonly edgeSpeed = new Float64Array(EDGES.length);
  // Each edge's shape in metres, as [x0, y0, x1, y1, ...] from its start node to its end node.
  readonly edgeShape: Float64Array[];
  private readonly outgoing: number[][] = Array.from({ length: NODE_COUNT }, () => []);
  private readonly incoming: number[][] = Array.from({ length: NODE_COUNT }, () => []);

  constructor(
    readonly ground: Ground,
    safeLat: number,
  ) {
    const segmentIndex = new Map(ground.segments.map((s, i) => [s.key, i]));
    for (let n = 0; n < NODE_COUNT; n++) {
      const point = nodePoint(n);
      [this.nodeX[n], this.nodeY[n]] = toXY(point);
      this.safe[n] = point.lat < safeLat ? 1 : 0;
    }
    this.edgeShape = EDGES.map((edge, e) => {
      this.outgoing[edge.u].push(e);
      this.incoming[edge.v].push(e);
      this.edgeSegment[e] = segmentIndex.get(segmentKeyOf(edge.key)) ?? -1;
      this.edgeSpeed[e] = Math.max(edge.meters / Math.max(edge.seconds, 1), 4);
      const shape = (edge.geometry ?? [[nodePoint(edge.u).lat, nodePoint(edge.u).lng], [nodePoint(edge.v).lat, nodePoint(edge.v).lng]]).flatMap(
        ([lat, lng]) => toXY({ lat, lng }),
      );
      const mid = Math.floor(shape.length / 4) * 2;
      const cell = cellIndex(ground, shape[mid], shape[mid + 1]);
      this.edgeFire[e] = cell < 0 ? NEVER_BURNS : ground.fireMinutes[cell];
      return Float64Array.from(shape);
    });
  }

  // Effective drive time of an edge for a driver, or Infinity if it won't use it.
  edgeSeconds(edge: number, minutes: number, blocked: ReadonlySet<number>) {
    if (this.edgeFire[edge] <= minutes || blocked.has(this.edgeSegment[edge])) return Infinity;
    const seconds = EDGES[edge].seconds;
    return this.edgeFire[edge] - minutes <= DANGER_MINUTES ? seconds * DANGER_SLOWDOWN : seconds;
  }

  potential(minutes: number, blocked: ReadonlySet<number>): Potential {
    const phi = new Float64Array(NODE_COUNT).fill(Infinity);
    const heap = new IndexHeap(4096);
    for (let n = 0; n < NODE_COUNT; n++) {
      if (!this.safe[n]) continue;
      phi[n] = 0;
      heap.push(0, n);
    }
    while (heap.size > 0) {
      const node = heap.pop();
      const time = heap.lastKey;
      if (time > phi[node]) continue;
      for (const edge of this.incoming[node]) {
        const arrival = time + this.edgeSeconds(edge, minutes, blocked);
        const from = EDGES[edge].u;
        if (arrival >= phi[from]) continue;
        phi[from] = arrival;
        heap.push(arrival, from);
      }
    }
    return { minutes, phi };
  }

  // The street to take out of `node`, or -1 when no known route leads to safety.
  nextEdge(node: number, potential: Potential, blocked: ReadonlySet<number>) {
    let best = -1;
    let bestTime = Infinity;
    for (const edge of this.outgoing[node]) {
      const time = this.edgeSeconds(edge, potential.minutes, blocked) + potential.phi[EDGES[edge].v];
      if (time < bestTime) {
        best = edge;
        bestTime = time;
      }
    }
    return best;
  }

  edgeEnd(edge: number) {
    return EDGES[edge].v;
  }

  edgeStart(edge: number) {
    return EDGES[edge].u;
  }

  nearestNode(x: number, y: number) {
    let best = 0;
    let bestDistance = Infinity;
    for (let n = 0; n < NODE_COUNT; n++) {
      const d = (this.nodeX[n] - x) ** 2 + (this.nodeY[n] - y) ** 2;
      if (d < bestDistance) {
        best = n;
        bestDistance = d;
      }
    }
    return best;
  }
}
