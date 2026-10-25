import { closedEdgeSet, EDGES, edgePath, nearestNode, shortestPathsFrom } from "./roadGraph";
import type { Point } from "./model";

// The fastest drive from a home to a shelter on the road graph, around the closed roads, for the
// voice agent to read out. Free-flow times: it is the way out, not a promise of how long it takes.

export type EscapeRoute = { streets: string[]; minutes: number; destination: string };
type Shelter = Point & { name: string };

// A street counts as a step of the route once the drive stays on it this far; shorter ones are turns.
const STEP_METERS = 250;
const MAX_STEPS = 3;

// "North Lincoln Avenue" then "Lincoln Avenue" is one street to someone driving it.
const streetKey = (name: string) => name.replace(/^(north|south|east|west|n|s|e|w)\.?\s+/i, "").toLowerCase();

// The streets in the order driven, each once, keeping only the long stretches.
function routeSteps(edges: number[]) {
  const runs: { name: string; meters: number }[] = [];
  for (const index of edges) {
    const { name, meters } = EDGES[index];
    if (!name) continue;
    const last = runs.at(-1);
    if (last?.name === name) last.meters += meters;
    else runs.push({ name, meters });
  }
  const steps = new Map<string, string>();
  for (const run of runs) if (run.meters >= STEP_METERS && !steps.has(streetKey(run.name))) steps.set(streetKey(run.name), run.name);
  return [...steps.values()].slice(0, MAX_STEPS);
}

export function escapeRoute(home: Point, shelters: Shelter[], closures: { edgeKeys?: string[] }[]): EscapeRoute | null {
  if (shelters.length === 0) return null;
  const paths = shortestPathsFrom(nearestNode(home), closedEdgeSet(closures));
  const reachable = shelters
    .map((shelter) => ({ shelter, node: nearestNode(shelter) }))
    .filter(({ node }) => Number.isFinite(paths.seconds[node]))
    .sort((a, b) => paths.seconds[a.node] - paths.seconds[b.node]);
  const best = reachable.at(0);
  const edges = best ? edgePath(paths, best.node) : null;
  if (!best || !edges) return null;
  return { streets: routeSteps(edges), minutes: Math.max(1, Math.round(paths.seconds[best.node] / 60)), destination: best.shelter.name };
}
