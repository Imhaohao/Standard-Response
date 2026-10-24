import { GraphEdge, InkMapData, Point } from "./data";

// Street routing over the baked drive graph (Track D's drive.graphml, the same one Track C's
// dispatcher drives). The rescue map uses it to draw a van's way to its stops whenever the
// dispatcher hasn't sent a road path of its own, so a route always follows real streets.

type Router = { nodes: Point[]; outgoing: GraphEdge[][] };

const routers = new WeakMap<InkMapData, Router>();

function routerFor(data: InkMapData): Router {
  const cached = routers.get(data);
  if (cached) return cached;
  const outgoing: GraphEdge[][] = data.graph.nodes.map(() => []);
  for (const edge of data.graph.edges) outgoing[edge.u].push(edge);
  const router = { nodes: data.graph.nodes, outgoing };
  routers.set(data, router);
  return router;
}

function nearestNode(nodes: Point[], [x, y]: Point) {
  let best = 0;
  let bestDistance = Infinity;
  nodes.forEach(([nx, ny], index) => {
    const distance = (nx - x) ** 2 + (ny - y) ** 2;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

// A binary heap keyed on travel seconds; the graph is small, but routes are recomputed often.
class Frontier {
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
      const right = left + 1;
      let smallest = i;
      if (left < items.length && items[left].cost < items[smallest].cost) smallest = left;
      if (right < items.length && items[right].cost < items[smallest].cost) smallest = right;
      if (smallest === i) break;
      [items[smallest], items[i]] = [items[i], items[smallest]];
      i = smallest;
    }
    return top;
  }
}

function shortestEdges(router: Router, from: number, to: number, closed: Set<string>) {
  const cost = new Float64Array(router.nodes.length).fill(Infinity);
  const via: (GraphEdge | null)[] = router.nodes.map(() => null);
  const frontier = new Frontier();
  cost[from] = 0;
  frontier.push(from, 0);
  while (frontier.size > 0) {
    const { node, cost: reached } = frontier.pop();
    if (node === to) break;
    if (reached > cost[node]) continue;
    for (const edge of router.outgoing[node]) {
      if (closed.has(edge.key)) continue;
      const next = reached + edge.seconds;
      if (next >= cost[edge.v]) continue;
      cost[edge.v] = next;
      via[edge.v] = edge;
      frontier.push(edge.v, next);
    }
  }
  if (from !== to && !via[to]) return null;
  const edges: GraphEdge[] = [];
  for (let node = to; node !== from; node = via[node]!.u) edges.push(via[node]!);
  return edges.reverse();
}

// The streets from one place to the next, with a short straight hop at each end to the door.
// Returns null when closures leave no way through.
export function roadRoute(data: InkMapData, from: Point, to: Point, closed: Set<string>): Point[] | null {
  const router = routerFor(data);
  const edges = shortestEdges(router, nearestNode(router.nodes, from), nearestNode(router.nodes, to), closed);
  if (!edges) return null;
  return [from, ...edges.flatMap((edge) => edge.shape), to];
}

// A van's whole run: from where it is, through each stop in order.
export function runRoute(data: InkMapData, start: Point, stops: Point[], closed: Set<string>): Point[] | null {
  const route: Point[] = [];
  let from = start;
  for (const stop of stops) {
    const leg = roadRoute(data, from, stop, closed);
    if (!leg) return route.length > 1 ? route : null;
    route.push(...leg);
    from = stop;
  }
  return route;
}
