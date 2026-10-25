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

// A point on a street, in one direction it can be driven: the directed edge, the stretch of its
// shape the point is on (0 the first), how far along the edge it is in metres, and where it is.
export type StreetPoint = { edge: number; stretch: number; along: number; x: number; y: number };

// Grid cell for finding the street nearest a point, in metres.
const STRETCH_CELL = 100;

// The keys of the cells `ring` cells out from (col, row), the outline of that square.
function ringCells(col: number, row: number, ring: number) {
  if (ring === 0) return [`${col},${row}`];
  const keys: string[] = [];
  for (let c = col - ring; c <= col + ring; c++) keys.push(`${c},${row - ring}`, `${c},${row + ring}`);
  for (let r = row - ring + 1; r < row + ring; r++) keys.push(`${col - ring},${r}`, `${col + ring},${r}`);
  return keys;
}

// An option drawn with logit probabilities over drive times to safety, proportional to
// exp(-seconds / spread): its index, or -1 when none reaches safety. A spread of 0 always takes the
// fastest.
export function logitChoice(seconds: number[], spreadSeconds: number, random: Random) {
  let best = -1;
  for (let k = 0; k < seconds.length; k++) if (seconds[k] < (best < 0 ? Infinity : seconds[best])) best = k;
  if (best < 0 || spreadSeconds <= 0) return best;
  const weights = seconds.map((time) => Math.exp((seconds[best] - time) / spreadSeconds));
  let draw = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let k = 0; k < weights.length; k++) {
    draw -= weights[k];
    if (draw < 0) return k;
  }
  return best;
}

// `delay` is each edge's congestion multiplier on its drive time, or null for free flow.
export type Potential = { minutes: number; phi: Float64Array; delay: Float64Array | null };

// A street's free-flow speed in m/s as the dynamics drive it: its length over its drive time, at least 4 m/s.
export function freeSpeedOf(edge: number) {
  return Math.max(EDGES[edge].meters / Math.max(EDGES[edge].seconds, 1), 4);
}

// When the fire first reaches a cell under a street's shape (its points every third of a cell),
// NEVER_BURNS if never. Read at the street's midpoint alone, 93 of the 150 streets the scenario fire
// reaches burn somewhere earlier, a median 16 minutes, and drivers were routed onto them meanwhile.
function firstFireAlong(ground: Ground, shape: number[]) {
  let first: number = NEVER_BURNS;
  for (let p = 0; p + 3 < shape.length; p += 2) {
    const [ax, ay, bx, by] = shape.slice(p, p + 4);
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (ground.cell / 3)));
    for (let k = 0; k <= steps; k++) {
      const cell = cellIndex(ground, ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps);
      if (cell >= 0) first = Math.min(first, ground.fireMinutes[cell]);
    }
  }
  return first;
}

export class RoadRouter {
  readonly nodeX = new Float64Array(NODE_COUNT);
  readonly nodeY = new Float64Array(NODE_COUNT);
  readonly safe = new Uint8Array(NODE_COUNT);
  readonly safeNodes: number[] = [];
  // When the fire reaches each intersection, in minutes.
  readonly nodeFire = new Float64Array(NODE_COUNT);
  readonly edgeSegment = new Int32Array(EDGES.length);
  // When the fire first reaches any part of each edge, in minutes: from then on it is a wall
  // somewhere along it.
  readonly edgeFire = new Float64Array(EDGES.length);
  readonly edgeSpeed = new Float64Array(EDGES.length);
  // Lanes in each edge's direction, and the cars that fill it bumper to bumper.
  readonly edgeLanes = new Float64Array(EDGES.length);
  // Whether each edge's street is two-way, so its lanes are right of the centreline, not across it.
  readonly edgeTwoWay = new Uint8Array(EDGES.length);
  readonly edgeJamCars = new Float64Array(EDGES.length);
  // Each edge's shape in metres, as [x0, y0, x1, y1, ...] from its start node to its end node, and
  // its length along that shape.
  readonly edgeShape: Float64Array[];
  readonly edgeLength = new Float64Array(EDGES.length);
  // The same street driven the other way, or -1 for a one-way street.
  readonly edgeReverse = new Int32Array(EDGES.length).fill(-1);
  // The stretches (edge, stretch index, edge, ...) that pass through each STRETCH_CELL cell, built
  // on first use.
  private stretchGrid: Map<string, number[]> | null = null;
  private stretchBounds = { cols: [Infinity, -Infinity], rows: [Infinity, -Infinity] };
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
      if (this.safe[n]) this.safeNodes.push(n);
      const cell = cellIndex(ground, this.nodeX[n], this.nodeY[n]);
      this.nodeFire[n] = cell < 0 ? NEVER_BURNS : ground.fireMinutes[cell];
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
      this.edgeFire[e] = firstFireAlong(ground, shape);
      for (let p = 2; p < shape.length; p += 2) this.edgeLength[e] += Math.hypot(shape[p] - shape[p - 2], shape[p + 1] - shape[p - 1]);
      return Float64Array.from(shape);
    });
    const byEnds = new Map(EDGES.map((edge, e) => [`${edge.u}-${edge.v}-${this.edgeSegment[e]}`, e]));
    EDGES.forEach((edge, e) => (this.edgeReverse[e] = byEnds.get(`${edge.v}-${edge.u}-${this.edgeSegment[e]}`) ?? -1));
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

  // The fastest drive to the safe intersections from every intersection, or to `targets` instead.
  potential(minutes: number, blocked: ReadonlySet<number>, delay: Float64Array | null = null, targets: number[] | null = null): Potential {
    const phi = new Float64Array(NODE_COUNT).fill(Infinity);
    const heap = new IndexHeap(4096);
    for (const n of targets ?? this.safeNodes) {
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

  // For a driver at `node` with no route to safety: the intersection it can reach that the fire
  // reaches last, the nearest of those; `node` itself if none is later.
  refuge(node: number, minutes: number, blocked: ReadonlySet<number>, delay: Float64Array | null = null) {
    const time = new Float64Array(NODE_COUNT).fill(Infinity);
    const heap = new IndexHeap(256);
    time[node] = 0;
    heap.push(0, node);
    let best = node;
    while (heap.size > 0) {
      const at = heap.pop();
      if (heap.lastKey > time[at]) continue;
      if (this.nodeFire[at] > this.nodeFire[best]) best = at;
      for (const edge of this.outgoing[at]) {
        const arrival = heap.lastKey + this.edgeSeconds(edge, minutes, blocked, delay);
        const to = EDGES[edge].v;
        if (arrival >= time[to]) continue;
        time[to] = arrival;
        heap.push(arrival, to);
      }
    }
    return best;
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
    const candidates = this.outgoing[node].filter((edge) => edge === best || potential.phi[EDGES[edge].v] < potential.phi[node]);
    const choice = logitChoice(
      candidates.map((edge) => this.routeSeconds(edge, potential, blocked)),
      spreadSeconds,
      random,
    );
    return choice < 0 ? best : candidates[choice];
  }

  // Seconds to safety from a point on a street: the rest of its edge, then phi at the edge's end.
  joinSeconds(point: StreetPoint, potential: Potential, blocked: ReadonlySet<number>) {
    const seconds = this.edgeSeconds(point.edge, potential.minutes, blocked, potential.delay);
    const rest = Math.max(0, 1 - point.along / Math.max(this.edgeLength[point.edge], 1e-6));
    return seconds * rest + potential.phi[EDGES[point.edge].v];
  }

  // The point on any street `allowed` takes nearest (x, y), in each direction the street can be
  // driven: one point for a one-way street, two for a two-way one. Empty if `allowed` takes none.
  streetPoints(x: number, y: number, allowed: (edge: number) => boolean = () => true): StreetPoint[] {
    const best = this.nearestStretch(x, y, allowed);
    if (!best) return [];
    const reverse = this.edgeReverse[best.edge];
    if (reverse < 0) return [best];
    // The same place on the other direction's shape.
    let back = this.onStretch(reverse, 0, best.x, best.y);
    for (let stretch = 1; stretch < this.edgeShape[reverse].length / 2 - 1; stretch++) {
      const point = this.onStretch(reverse, stretch, best.x, best.y);
      if (Math.hypot(point.x - best.x, point.y - best.y) < Math.hypot(back.x - best.x, back.y - best.y)) back = point;
    }
    return [best, back];
  }

  // The point on a street `allowed` takes nearest (x, y), or null if it takes none.
  private nearestStretch(x: number, y: number, allowed: (edge: number) => boolean): StreetPoint | null {
    const grid = (this.stretchGrid ??= this.buildStretchGrid());
    const col = Math.floor(x / STRETCH_CELL);
    const row = Math.floor(y / STRETCH_CELL);
    const { cols, rows } = this.stretchBounds;
    // Every ring of cells out to the far side of the grid.
    const rings = Math.max(col - cols[0], cols[1] - col, row - rows[0], rows[1] - row);
    let best: StreetPoint | null = null;
    let bestDistance = Infinity;
    // Ring by ring outward: once rings 0 to r are searched every stretch within r cells of (x, y)
    // has been seen, so the nearest found that close is the nearest of all.
    for (let ring = 0; ring <= rings && !(best && bestDistance <= (ring - 1) * STRETCH_CELL); ring++) {
      for (const key of ringCells(col, row, ring)) {
        const stretches = grid.get(key) ?? [];
        for (let k = 0; k < stretches.length; k += 2) {
          if (!allowed(stretches[k])) continue;
          const point = this.onStretch(stretches[k], stretches[k + 1], x, y);
          const distance = Math.hypot(point.x - x, point.y - y);
          if (distance >= bestDistance) continue;
          best = point;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  // The point of stretch `stretch` of `edge` nearest (x, y).
  private onStretch(edge: number, stretch: number, x: number, y: number): StreetPoint {
    const shape = this.edgeShape[edge];
    const [ax, ay, bx, by] = shape.subarray(2 * stretch, 2 * stretch + 4);
    const length2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length2)) : 0;
    let along = t * Math.sqrt(length2);
    for (let p = 2; p <= 2 * stretch; p += 2) along += Math.hypot(shape[p] - shape[p - 2], shape[p + 1] - shape[p - 1]);
    return { edge, stretch, along, x: ax + t * (bx - ax), y: ay + t * (by - ay) };
  }

  private buildStretchGrid() {
    const grid = new Map<string, number[]>();
    const { cols, rows } = this.stretchBounds;
    this.edgeShape.forEach((shape, edge) => {
      for (let stretch = 0; 2 * stretch + 3 < shape.length; stretch++) {
        const [ax, ay, bx, by] = shape.subarray(2 * stretch, 2 * stretch + 4);
        for (let r = Math.floor(Math.min(ay, by) / STRETCH_CELL); r <= Math.floor(Math.max(ay, by) / STRETCH_CELL); r++) {
          for (let c = Math.floor(Math.min(ax, bx) / STRETCH_CELL); c <= Math.floor(Math.max(ax, bx) / STRETCH_CELL); c++) {
            const key = `${c},${r}`;
            grid.set(key, [...(grid.get(key) ?? []), edge, stretch]);
            [cols[0], cols[1], rows[0], rows[1]] = [Math.min(cols[0], c), Math.max(cols[1], c), Math.min(rows[0], r), Math.max(rows[1], r)];
          }
        }
      }
    });
    return grid;
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
