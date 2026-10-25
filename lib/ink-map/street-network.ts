import { InkMapData, MINOR_ROAD_CLASS, Point } from "./data";

// Every drawn street as a walkable network, for boundaries a dispatcher draws on the map. The
// drive graph the vans route on skips many residential streets, so a corner snapped to it can land
// a block away from where someone clicked; this one has every street the map shows.

type Link = { to: number; meters: number };
export type StreetNetwork = { points: Point[]; links: Link[][]; corners: number[] };

const networks = new WeakMap<InkMapData, StreetNetwork>();

function buildNetwork(data: InkMapData): StreetNetwork {
  const indexOf = new Map<string, number>();
  const points: Point[] = [];
  const links: Link[][] = [];
  const roadsAt: number[] = [];
  const nodeAt = (point: Point) => {
    const key = `${point[0].toFixed(1)},${point[1].toFixed(1)}`;
    let index = indexOf.get(key);
    if (index === undefined) {
      index = points.length;
      indexOf.set(key, index);
      points.push(point);
      links.push([]);
      roadsAt.push(0);
    }
    return index;
  };
  for (const road of data.roads) {
    if (road.roadClass > MINOR_ROAD_CLASS || road.tunnel) continue;
    const nodes = road.path.map(nodeAt);
    for (const node of new Set(nodes)) roadsAt[node] += 1;
    for (let i = 1; i < nodes.length; i++) {
      const [a, b] = [nodes[i - 1], nodes[i]];
      const meters = Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]);
      links[a].push({ to: b, meters });
      links[b].push({ to: a, meters });
    }
  }
  const corners = points.map((_, index) => index).filter((index) => roadsAt[index] > 1 || links[index].length > 2);
  return { points, links, corners };
}

export function streetNetwork(data: InkMapData) {
  let network = networks.get(data);
  if (!network) {
    network = buildNetwork(data);
    networks.set(data, network);
  }
  return network;
}

// The street corner nearest a point, if one is within reach.
export function nearestCorner(network: StreetNetwork, [x, y]: Point, withinMeters: number): number | null {
  let best: number | null = null;
  let bestDistance = withinMeters;
  for (const corner of network.corners) {
    const [cx, cy] = network.points[corner];
    const distance = Math.hypot(cx - x, cy - y);
    if (distance < bestDistance) {
      best = corner;
      bestDistance = distance;
    }
  }
  return best;
}

function distanceToChord([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) {
  const [dx, dy] = [bx - ax, by - ay];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const STRAY_METERS = 50;

class MinHeap {
  private items: { node: number; cost: number }[] = [];

  get size() {
    return this.items.length;
  }

  push(node: number, cost: number) {
    const items = this.items;
    items.push({ node, cost });
    for (let i = items.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= items[i].cost) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length === 0) return top;
    items[0] = last;
    for (let i = 0; ; ) {
      const left = i * 2 + 1;
      const smallest = [left, left + 1].reduce((best, child) => (child < items.length && items[child].cost < items[best].cost ? child : best), i);
      if (smallest === i) break;
      [items[smallest], items[i]] = [items[i], items[smallest]];
      i = smallest;
    }
    return top;
  }
}

function tracePath(network: StreetNetwork, via: Int32Array, from: number, to: number) {
  const path: Point[] = [];
  for (let node = to; node !== from; node = via[node]) path.push(network.points[node]);
  path.push(network.points[from]);
  return path.reverse();
}

// The streets from one corner to another. A boundary should go where the person drawing it pointed,
// not along the quickest drive, so each stretch costs its length, doubled for every 50 m it strays
// from the straight line between the corners. Falls back to that straight line when no street joins them.
export function streetsBetweenCorners(network: StreetNetwork, from: number, to: number): Point[] {
  const [a, b] = [network.points[from], network.points[to]];
  if (from === to) return [a];
  const cost = new Float64Array(network.points.length).fill(Infinity);
  const via = new Int32Array(network.points.length).fill(-1);
  const frontier = new MinHeap();
  cost[from] = 0;
  frontier.push(from, 0);
  while (frontier.size > 0) {
    const { node, cost: reached } = frontier.pop();
    if (node === to) return tracePath(network, via, from, to);
    if (reached > cost[node]) continue;
    for (const { to: next, meters } of network.links[node]) {
      const total = reached + meters * (1 + distanceToChord(network.points[next], a, b) / STRAY_METERS);
      if (total >= cost[next]) continue;
      cost[next] = total;
      via[next] = node;
      frontier.push(next, total);
    }
  }
  return [a, b];
}

// ---- Routes along every drawn street ----
// The drive graph the dispatcher plans on skips many residential streets, so a route drawn on it
// cuts straight across blocks to reach a door. Routes the map draws use this network instead.

const GRID_METERS = 60;
const grids = new WeakMap<StreetNetwork, Map<string, number[]>>();

const cellKey = (x: number, y: number) => `${Math.floor(x / GRID_METERS)},${Math.floor(y / GRID_METERS)}`;

function nodeGrid(network: StreetNetwork) {
  let grid = grids.get(network);
  if (!grid) {
    grid = new Map();
    network.points.forEach(([x, y], index) => {
      const key = cellKey(x, y);
      const cell = grid!.get(key);
      if (cell) cell.push(index);
      else grid!.set(key, [index]);
    });
    grids.set(network, grid);
  }
  return grid;
}

// The street vertex nearest a point, searching outward ring by ring through the grid.
export function nearestStreetNode(network: StreetNetwork, [x, y]: Point, withinMeters = 600): number | null {
  const grid = nodeGrid(network);
  const [cx, cy] = [Math.floor(x / GRID_METERS), Math.floor(y / GRID_METERS)];
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let ring = 0; ring * GRID_METERS <= withinMeters; ring++) {
    for (let gx = cx - ring; gx <= cx + ring; gx++) {
      for (let gy = cy - ring; gy <= cy + ring; gy++) {
        if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue;
        for (const node of grid.get(`${gx},${gy}`) ?? []) {
          const distance = Math.hypot(network.points[node][0] - x, network.points[node][1] - y);
          if (distance < bestDistance) [best, bestDistance] = [node, distance];
        }
      }
    }
    if (best !== null && bestDistance <= ring * GRID_METERS) break;
  }
  return best;
}

export const linkKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// The shortest way by street from one vertex to another, skipping blocked links. A* toward the
// goal keeps a route between neighbours from searching the whole town.
function shortestStreets(network: StreetNetwork, from: number, to: number, blocked: Set<string>): Point[] | null {
  const goal = network.points[to];
  const toGoal = (node: number) => Math.hypot(network.points[node][0] - goal[0], network.points[node][1] - goal[1]);
  const cost = new Map<number, number>([[from, 0]]);
  const via = new Int32Array(network.points.length).fill(-1);
  const frontier = new MinHeap();
  frontier.push(from, toGoal(from));
  const settled = new Set<number>();
  while (frontier.size > 0) {
    const { node } = frontier.pop();
    if (node === to) return tracePath(network, via, from, to);
    if (settled.has(node)) continue;
    settled.add(node);
    const reached = cost.get(node)!;
    for (const { to: next, meters } of network.links[node]) {
      if (blocked.has(linkKey(node, next))) continue;
      const total = reached + meters;
      if (total >= (cost.get(next) ?? Infinity)) continue;
      cost.set(next, total);
      via[next] = node;
      frontier.push(next, total + toGoal(next));
    }
  }
  return null;
}

export function streetRoute(network: StreetNetwork, from: Point, to: Point, blocked: Set<string>): Point[] | null {
  const start = nearestStreetNode(network, from);
  const end = nearestStreetNode(network, to);
  if (start === null || end === null) return null;
  const streets = start === end ? [network.points[start]] : shortestStreets(network, start, end, blocked);
  return streets ? [from, ...streets, to] : null;
}

const ON_CLOSED_METERS = 8;

function nearShape(point: Point, shape: Point[]) {
  for (let i = 1; i < shape.length; i++) if (distanceToChord(point, shape[i - 1], shape[i]) <= ON_CLOSED_METERS) return true;
  return false;
}

// Closures name blocks of the drive graph. The street links lying along a closed block, both ends
// within a few metres of it, are the ones a route must not use.
export function blockedStreets(network: StreetNetwork, data: InkMapData, closedEdges: Set<string>) {
  const blocked = new Set<string>();
  for (const edge of data.graph.edges) {
    if (!closedEdges.has(edge.key)) continue;
    const near = new Set<number>();
    for (const point of edge.shape) {
      const node = nearestStreetNode(network, point, GRID_METERS);
      if (node !== null && nearShape(network.points[node], edge.shape)) near.add(node);
    }
    const along = [...near];
    for (const node of along) {
      for (const { to } of network.links[node]) if (nearShape(network.points[to], edge.shape)) blocked.add(linkKey(node, to));
    }
  }
  return blocked;
}
