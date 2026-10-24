import type { Point } from "./data";
import { contains } from "./fire-field";
import type { StreetNetwork } from "./street-network";

// City blocks: the areas the streets enclose. Every street is two half-edges, one each way, and
// walking half-edges while always taking the sharpest left turn circles one block counter-clockwise.
// A zone made of whole blocks has streets for its edges, so it can be drawn corner to corner.

type HalfEdges = { from: Int32Array; to: Int32Array; twin: Int32Array; next: Int32Array; face: Int32Array };
type Block = { nodes: number[]; ring: Point[]; area: number; box: [number, number, number, number] };
type Blocks = { edges: HalfEdges; blocks: Block[] };

const cache = new WeakMap<StreetNetwork, Blocks>();

function signedArea(ring: Point[]) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return area / 2;
}

// Each node's distinct neighbors, sorted counter-clockwise by the direction of the street to them.
function sortedNeighbors(network: StreetNetwork) {
  return network.links.map((links, node) => {
    const [x, y] = network.points[node];
    const bearing = (other: number) => Math.atan2(network.points[other][1] - y, network.points[other][0] - x);
    return [...new Set(links.map((link) => link.to))].filter((other) => other !== node).sort((a, b) => bearing(a) - bearing(b));
  });
}

function halfEdges(network: StreetNetwork): Omit<HalfEdges, "face"> {
  const around = sortedNeighbors(network);
  const first = new Int32Array(around.length + 1);
  around.forEach((neighbors, node) => (first[node + 1] = first[node] + neighbors.length));
  const count = first[around.length];
  const [from, to, twin, next] = [new Int32Array(count), new Int32Array(count), new Int32Array(count), new Int32Array(count)];
  const idOf = (a: number, b: number) => first[a] + around[a].indexOf(b);
  around.forEach((neighbors, a) =>
    neighbors.forEach((b, slot) => {
      const id = first[a] + slot;
      from[id] = a;
      to[id] = b;
      twin[id] = idOf(b, a);
      // Leaving b, the street just clockwise of the one back to a keeps the block on the left.
      const back = around[b].indexOf(a);
      next[id] = first[b] + ((back - 1 + around[b].length) % around[b].length);
    }),
  );
  return { from, to, twin, next };
}

function traceBlocks(network: StreetNetwork): Blocks {
  const edges = { ...halfEdges(network), face: new Int32Array(0) };
  edges.face = new Int32Array(edges.from.length).fill(-1);
  const blocks: Block[] = [];
  for (let start = 0; start < edges.from.length; start++) {
    if (edges.face[start] >= 0) continue;
    const nodes: number[] = [];
    for (let edge = start; edges.face[edge] < 0; edge = edges.next[edge]) {
      edges.face[edge] = blocks.length;
      nodes.push(edges.from[edge]);
    }
    const ring = nodes.map((node) => network.points[node]);
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    blocks.push({ nodes, ring, area: signedArea(ring), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  return { edges, blocks };
}

function blocksOf(network: StreetNetwork) {
  let traced = cache.get(network);
  if (!traced) {
    traced = traceBlocks(network);
    cache.set(network, traced);
  }
  return traced;
}

// The smallest block around a point. Clockwise loops are the outsides of separate street networks, not blocks.
function blockAt(blocks: Block[], [x, y]: Point) {
  let best = -1;
  for (const [index, block] of blocks.entries()) {
    const [x0, y0, x1, y1] = block.box;
    if (block.area <= 0 || x < x0 || x > x1 || y < y0 || y > y1 || !contains(block.ring, x, y)) continue;
    if (best < 0 || block.area < blocks[best].area) best = index;
  }
  return best;
}

// One loop of the outline of a set of blocks, starting along a street with a chosen block on its left
// and an unchosen one on its right. At each corner it turns onto the next such street.
function walkOutline(edges: HalfEdges, chosen: Set<number>, start: number, walked: Set<number>) {
  const nodes: number[] = [];
  let edge = start;
  do {
    walked.add(edge);
    nodes.push(edges.from[edge]);
    let turn = edges.next[edge];
    while (chosen.has(edges.face[edges.twin[turn]])) turn = edges.next[edges.twin[turn]];
    edge = turn;
  } while (edge !== start && !walked.has(edge));
  return nodes;
}

function outerOutline(network: StreetNetwork, edges: HalfEdges, chosen: Set<number>) {
  const walked = new Set<number>();
  let outer: { nodes: number[]; area: number } | null = null;
  for (let edge = 0; edge < edges.from.length; edge++) {
    if (walked.has(edge) || !chosen.has(edges.face[edge]) || chosen.has(edges.face[edges.twin[edge]])) continue;
    const nodes = walkOutline(edges, chosen, edge, walked);
    const area = signedArea(nodes.map((node) => network.points[node]));
    if (!outer || area > outer.area) outer = { nodes, area };
  }
  return outer?.nodes ?? [];
}

function cornersAlong(network: StreetNetwork, nodes: number[]) {
  const isCorner = new Set(network.corners);
  const corners = nodes.filter((node) => isCorner.has(node)).filter((node, i, all) => node !== all[(i + 1) % all.length]);
  return corners.length >= 3 ? corners : [];
}

// The outline of every block that holds one of the points, as the street corners along it in order,
// counter-clockwise. Empty when a point lies in no block: past the last street at the edge of town,
// or where a street stops short of the next one and leaves its block open.
export function blockCorners(network: StreetNetwork, points: Point[]): number[] {
  const { edges, blocks } = blocksOf(network);
  const chosen = new Set(points.map((point) => blockAt(blocks, point)));
  if (chosen.has(-1) || chosen.size === 0) return [];
  return cornersAlong(network, outerOutline(network, edges, chosen));
}
