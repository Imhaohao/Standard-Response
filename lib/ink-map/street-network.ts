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
