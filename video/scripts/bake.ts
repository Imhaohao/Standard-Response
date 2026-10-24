// Bakes the real Altadena data into screen space for the flat map plate (1920x1080, the /lab
// flat view). Run from video/: `npm run bake` after `npm run fetch-live`.
import { readFileSync, writeFileSync } from "node:fs";
import { fitFrame, TOWN_FRAME } from "../../components/map/projection";
import { createProjection, Point } from "../../lib/ink-map/data";

type LatLng = { lat: number; lng: number };
type Household = LatLng & { id: string; mobility: string; canLeave: string };
type Vehicle = LatLng & { _id: string; label: string };
type Offer = LatLng & { vehicleId: string; stopOrder: number; status: string; needsLift: boolean };
type RawGraph = { nodes: number[]; edges: number[][] };
type Front = { properties: { minutesAfterWarning: number }; geometry: { type: string; coordinates: number[][][] | number[][][][] } };

const SIZE = { width: 1920, height: 1080 };
const root = new URL("../../", import.meta.url);
const live = new URL("../live/", import.meta.url);
const readJson = <T>(path: string, base = root): T => JSON.parse(readFileSync(new URL(path, base), "utf8")) as T;

const rawMap = readJson<{ origin: LatLng; graph: RawGraph }>("public/map/altadena.json");
const { toLocal } = createProjection(rawMap.origin);
const project = fitFrame(TOWN_FRAME, SIZE, "cover");
const screen = (point: Point): [number, number] => {
  const { x, y } = project(point);
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
};
const onScreen = ([x, y]: [number, number], pad = 0) => x >= -pad && y >= -pad && x <= SIZE.width + pad && y <= SIZE.height + pad;

const decimeters = (flat: number[], start: number): Point[] => {
  const out: Point[] = [];
  for (let i = start; i + 1 < flat.length; i += 2) out.push([flat[i] / 10, flat[i + 1] / 10]);
  return out;
};

const nodes = decimeters(rawMap.graph.nodes, 0);
type Edge = { u: number; v: number; seconds: number; shape: Point[] };
const edges: Edge[] = rawMap.graph.edges.map((e) => ({ u: e[0], v: e[1], seconds: e[2] / 10, shape: decimeters(e, 3) }));
const outgoing = new Map<number, number[]>();
edges.forEach((edge, index) => outgoing.set(edge.u, [...(outgoing.get(edge.u) ?? []), index]));

function nearestNode(point: Point) {
  let best = 0;
  let bestDistance = Infinity;
  nodes.forEach(([x, y], index) => {
    const distance = (x - point[0]) ** 2 + (y - point[1]) ** 2;
    if (distance < bestDistance && outgoing.has(index)) [best, bestDistance] = [index, distance];
  });
  return best;
}

function popCheapest(open: Set<number>, cost: Float64Array) {
  let best = -1;
  for (const node of open) if (best < 0 || cost[node] < cost[best]) best = node;
  open.delete(best);
  return best;
}

// Plain Dijkstra over drive time. The graph is small enough that a set scan beats a heap here.
function shortestEdges(from: number, to: number, closed: Set<number>) {
  const cost = new Float64Array(nodes.length).fill(Infinity);
  const via = new Int32Array(nodes.length).fill(-1);
  const open = new Set([from]);
  cost[from] = 0;
  while (open.size) {
    const node = popCheapest(open, cost);
    if (node === to) break;
    for (const index of outgoing.get(node) ?? []) {
      if (closed.has(index)) continue;
      const edge = edges[index];
      const next = cost[node] + edge.seconds;
      if (next >= cost[edge.v]) continue;
      cost[edge.v] = next;
      via[edge.v] = index;
      open.add(edge.v);
    }
  }
  const path: number[] = [];
  for (let node = to; node !== from && via[node] >= 0; node = edges[via[node]].u) path.unshift(via[node]);
  return path;
}

const edgePoints = (index: number) => {
  const edge = edges[index];
  return edge.shape.length > 1 ? edge.shape : [nodes[edge.u], nodes[edge.v]];
};
const polyline = (edgeIndexes: number[]) => edgeIndexes.flatMap(edgePoints).map(screen);
const lengthOf = (line: [number, number][]) => line.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - line[i][0], y - line[i][1]), 0);

function householdKind(household: Household, index: number) {
  if (index % 29 === 7) return 3;
  if (["manual_wheelchair", "power_wheelchair", "bedbound"].includes(household.mobility)) return 0;
  if (household.canLeave !== "yes") return 1;
  return 2;
}

const households = readJson<Household[]>("data/population.json")
  .filter((household) => household.mobility !== "walks" || household.canLeave !== "yes")
  .map((household, index) => ({ at: screen(toLocal(household)), kind: householdKind(household, index) }))
  .filter(({ at }) => onScreen(at, -20));

// The scenario fronts come off a raster, so their edges are staircases. Thin, then round them.
function smoothRing(ring: [number, number][]) {
  let points = ring.filter((_, i) => i % 6 === 0);
  for (let pass = 0; pass < 3; pass++) {
    points = points.flatMap((point, i) => {
      const next = points[(i + 1) % points.length];
      const mix = (t: number): [number, number] => [point[0] + (next[0] - point[0]) * t, point[1] + (next[1] - point[1]) * t];
      return [mix(0.25), mix(0.75)];
    });
  }
  return points.map(([x, y]): [number, number] => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

const fronts = readJson<{ features: Front[] }>("data/hazard/scenario-spread.geojson")
  .features.map((feature) => {
    const rings = feature.geometry.type === "Polygon" ? (feature.geometry.coordinates as number[][][]) : (feature.geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);
    return { minutes: feature.properties.minutesAfterWarning, rings: rings.map((ring) => smoothRing(ring.map(([lng, lat]) => screen(toLocal({ lat, lng }))))) };
  })
  .sort((a, b) => a.minutes - b.minutes);

const vehicles = readJson<Vehicle[]>("vehicles_list.json", live);
const offers = readJson<Offer[]>("offers_active.json", live);

const runs = vehicles.map((vehicle) => {
  const stops = offers.filter((offer) => offer.vehicleId === vehicle._id).sort((a, b) => a.stopOrder - b.stopOrder);
  const nodeChain = [vehicle, ...stops].map((place) => nearestNode(toLocal(place)));
  const edgeChain = nodeChain.slice(1).flatMap((to, i) => shortestEdges(nodeChain[i], to, new Set()));
  const path = polyline(edgeChain);
  return {
    label: vehicle.label,
    at: screen(toLocal(vehicle)),
    stops: stops.map((stop) => ({ at: screen(toLocal(stop)), lift: stop.needsLift, accepted: stop.status === "accepted" })),
    path,
    length: Math.round(lengthOf(path)),
    nodeChain,
  };
});

// The road-closure beat: the longest first leg, one street in its middle closed, the detour found.
const closureRun = [...runs].sort((a, b) => b.length - a.length)[0];
const firstLeg = shortestEdges(closureRun.nodeChain[0], closureRun.nodeChain[1], new Set());
const blocked = firstLeg[Math.floor(firstLeg.length / 2)];
const reverse = edges.findIndex((edge) => edge.u === edges[blocked].v && edge.v === edges[blocked].u);
const detour = shortestEdges(closureRun.nodeChain[0], closureRun.nodeChain[1], new Set([blocked, reverse]));

const scene = {
  size: SIZE,
  households,
  fronts,
  runs: runs.map((run) => ({ label: run.label, at: run.at, stops: run.stops, path: run.path, length: run.length })),
  reroute: {
    label: closureRun.label,
    from: closureRun.at,
    to: closureRun.stops[0].at,
    before: polyline(firstLeg),
    closed: edgePoints(blocked).map(screen),
    after: polyline(detour),
  },
};

writeFileSync(new URL("../src/data/scene.json", import.meta.url), JSON.stringify(scene));
console.log({
  households: households.length,
  kinds: [0, 1, 2, 3].map((kind) => households.filter((h) => h.kind === kind).length),
  fronts: fronts.length,
  runs: runs.map((run) => `${run.label}:${run.stops.length}/${run.length}px`),
  reroute: [scene.reroute.before.length, scene.reroute.after.length],
});
