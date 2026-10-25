import { EDGES, NODE_COUNT, nodePoint } from "../../convex/roadGraph";
import { cellIndex, Ground, toXY } from "./grid";
import { NEVER_BURNS } from "../ink-map/fire-field";
import { Random } from "../mesh/random";
import { segmentKeyOf } from "../mesh/roads";
import { JAM_SPACING_METERS, MIN_SPEED_SHARE } from "./greenshields";

export { JAM_SPACING_METERS, MIN_SPEED_SHARE };

// Route choice. Every driver holds a potential over the street graph: phi(n), the fastest drive
// from intersection n to safety, avoiding streets the fire has reached and the streets that driver
// believes are blocked, and crawling past streets the fire reaches within DANGER_MINUTES. The
// potential is one reverse Dijkstra from the safe intersections, under a millisecond on this graph,
// so each driver can route on exactly what it knows.
//
// Drive times are congestion-aware. Each street's time is stretched by the cars on it when the
// potential was built, by Greenshields' speed-density line v = v_free (1 - k / k_jam), the same
// law the crowd dynamics drive by. So a jammed arterial costs more and later drivers route around it.
//
// At each intersection a driver doesn't always take the cheapest street. It picks among the streets
// that lead downhill in the potential with logit probabilities, proportional to
// exp(-(drive time + phi at the far end) / spread). That is Dial's (1971) stochastic assignment:
// near-equal routes share the traffic, and the downhill rule means a route can't loop.

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

// `delay` is each edge's congestion multiplier on its drive time, or null for free flow.
export type Potential = { minutes: number; phi: Float64Array; delay: Float64Array | null };

// A street's free-flow speed in m/s as the dynamics drive it: its length over its drive time, at least 4 m/s.
export function freeSpeedOf(edge: number) {
  return Math.max(EDGES[edge].meters / Math.max(EDGES[edge].seconds, 1), 4);
}

export class RoadRouter {
  readonly nodeX = new Float64Array(NODE_COUNT);
  readonly nodeY = new Float64Array(NODE_COUNT);
  readonly safe = new Uint8Array(NODE_COUNT);
  readonly edgeSegment = new Int32Array(EDGES.length);
  readonly edgeFire = new Float64Array(EDGES.length);
  readonly edgeSpeed = new Float64Array(EDGES.length);
  // Lanes in each edge's direction, and the cars that fill it bumper to bumper.
  readonly edgeLanes = new Float64Array(EDGES.length);
  // Whether each edge's street is two-way, so its lanes are right of the centreline, not across it.
  readonly edgeTwoWay = new Uint8Array(EDGES.length);
  readonly edgeJamCars = new Float64Array(EDGES.length);
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
    const directed = new Set(EDGES.map((edge) => `${edge.u}-${edge.v}`));
    this.edgeShape = EDGES.map((edge, e) => {
      this.outgoing[edge.u].push(e);
      this.incoming[edge.v].push(e);
      this.edgeSegment[e] = segmentIndex.get(segmentKeyOf(edge.key)) ?? -1;
      this.edgeSpeed[e] = freeSpeedOf(e);
      // A two-way street's lane count covers both directions.
      this.edgeTwoWay[e] = directed.has(`${edge.v}-${edge.u}`) ? 1 : 0;
      this.edgeLanes[e] = this.edgeTwoWay[e] ? Math.max(1, Math.floor(edge.lanes / 2)) : edge.lanes;
      this.edgeJamCars[e] = Math.max(1, (edge.meters * this.edgeLanes[e]) / JAM_SPACING_METERS);
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
  edgeSeconds(edge: number, minutes: number, blocked: ReadonlySet<number>, delay: Float64Array | null = null) {
    if (this.edgeFire[edge] <= minutes || blocked.has(this.edgeSegment[edge])) return Infinity;
    const seconds = EDGES[edge].seconds * (delay ? delay[edge] : 1);
    return this.edgeFire[edge] - minutes <= DANGER_MINUTES ? seconds * DANGER_SLOWDOWN : seconds;
  }

  // Each edge's congestion multiplier from the cars on it: 1 / (1 - k / k_jam), capped where the
  // street is at a standstill.
  delays(carsOnEdge: ArrayLike<number>) {
    const delay = new Float64Array(EDGES.length);
    for (let e = 0; e < delay.length; e++) {
      delay[e] = 1 / Math.max(MIN_SPEED_SHARE, 1 - carsOnEdge[e] / this.edgeJamCars[e]);
    }
    return delay;
  }

  potential(minutes: number, blocked: ReadonlySet<number>, delay: Float64Array | null = null): Potential {
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
        const arrival = time + this.edgeSeconds(edge, minutes, blocked, delay);
        const from = EDGES[edge].u;
        if (arrival >= phi[from]) continue;
        phi[from] = arrival;
        heap.push(arrival, from);
      }
    }
    return { minutes, phi, delay };
  }

  // Time to safety leaving `node` by `edge`: the edge's drive time plus phi at its far end.
  private routeSeconds(edge: number, potential: Potential, blocked: ReadonlySet<number>) {
    return this.edgeSeconds(edge, potential.minutes, blocked, potential.delay) + potential.phi[EDGES[edge].v];
  }

  // The fastest street out of `node`, or -1 when no known route leads to safety.
  nextEdge(node: number, potential: Potential, blocked: ReadonlySet<number>) {
    let best = -1;
    let bestTime = Infinity;
    for (const edge of this.outgoing[node]) {
      const time = this.routeSeconds(edge, potential, blocked);
      if (time < bestTime) {
        best = edge;
        bestTime = time;
      }
    }
    return best;
  }

  // A street out of `node` drawn with logit probabilities over the fastest one and every street
  // that leads downhill in the potential, or -1 when no known route leads to safety. A spread of 0
  // always takes the fastest.
  chooseEdge(node: number, potential: Potential, blocked: ReadonlySet<number>, spreadSeconds: number, random: Random) {
    const best = this.nextEdge(node, potential, blocked);
    if (best < 0 || spreadSeconds <= 0) return best;
    const bestTime = this.routeSeconds(best, potential, blocked);
    const candidates: number[] = [];
    const weights: number[] = [];
    let total = 0;
    for (const edge of this.outgoing[node]) {
      if (edge !== best && !(potential.phi[EDGES[edge].v] < potential.phi[node])) continue;
      const weight = Math.exp((bestTime - this.routeSeconds(edge, potential, blocked)) / spreadSeconds);
      candidates.push(edge);
      weights.push(weight);
      total += weight;
    }
    let draw = random() * total;
    for (const [k, edge] of candidates.entries()) {
      draw -= weights[k];
      if (draw < 0) return edge;
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
