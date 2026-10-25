import { Problem, ProblemRequest, Solution } from "./dispatchProblem";
import { solveHeuristic } from "./heuristic";
import { DEADLINE_MARGIN_MINUTES, Point } from "./model";
import { EDGES, EdgeTime, edgePath, legsFor, nearestNode, shortestPathsFrom } from "./roadGraph";
import { ENGINE, MOST_TRUCKS_TRIED, TruckSpec, UNLOAD_SECONDS } from "./vehicleRun";

// One fire engine works the warning zone alone. The competent heuristic orders its pickups by
// deadline; the run is then driven on the road graph at the engine's speed, boarding each party,
// unloading at the shelter when the cab is full, and checking every arrival against when the fire
// reaches that home. Nothing here decides that the truck fails: drive time against fire time does.
// All times are seconds after the warning, when the truck sets out knowing everyone who needs a ride.


export type TruckHome = { address: string; at: Point; people: number; boardingSeconds: number; fireSeconds: number };

export type HomeOutcome = "rescued" | "too_late" | "never_reached";
export type HomeResult = { reachedSeconds: number | null; outcome: HomeOutcome };

export type Leg = { startSeconds: number; path: Point[]; legSeconds: number[] };
export type Stop = { kind: "board" | "too_late" | "unload"; home: number | null; atSeconds: number; dwellSeconds: number; onboard: number };

export type TruckRun = { legs: Leg[]; stops: Stop[]; homes: HomeResult[]; endSeconds: number; trucksNeeded: number | null };

const METERS_PER_SECOND_PER_MPH = 0.44704;

// The engine drives no faster than the posted limit and no faster than its own average.
function engineEdgeTime(speedMph: number): EdgeTime {
  const metersPerSecond = speedMph * METERS_PER_SECOND_PER_MPH;
  return (edgeIndex) => Math.max(EDGES[edgeIndex].seconds, EDGES[edgeIndex].meters / metersPerSecond);
}

// A household bigger than the cab rides in trips: one party per cabful, all at the same door.
type Party = { home: number; people: number };

function partiesOf(homes: TruckHome[], seats: number): Party[] {
  return homes.flatMap((home, index) => {
    const parties: Party[] = [];
    for (let left = home.people; left > 0; left -= seats) parties.push({ home: index, people: Math.min(left, seats) });
    return parties;
  });
}

type World = { nodes: number[]; matrix: (number | null)[][]; edgeTime: EdgeTime };

// Locations: 0 the station, 1 the shelter, then one per home.
function buildWorld(station: Point, shelter: Point, homes: TruckHome[], edgeTime: EdgeTime): World {
  const nodes = [station, shelter, ...homes.map((home) => home.at)].map((point) => nearestNode(point));
  const matrix = nodes.map((from) => {
    const paths = shortestPathsFrom(from, new Set(), edgeTime);
    return nodes.map((to) => (Number.isFinite(paths.seconds[to]) ? paths.seconds[to] : null));
  });
  return { nodes, matrix, edgeTime };
}

function problemFor(world: World, homes: TruckHome[], parties: Party[], spec: TruckSpec, trucks: number): Problem {
  const requests: ProblemRequest[] = parties.map((party, i) => ({
    id: String(i),
    location: party.home + 2,
    load: { seats: party.people, wheelchairSpaces: 0, stretcherSpaces: 0 },
    boardingSeconds: homes[party.home].boardingSeconds,
    deadline: homes[party.home].fireSeconds - DEADLINE_MARGIN_MINUTES * 60,
    weight: 1,
    allowedVehicles: Array.from({ length: trucks }, (_, k) => k),
    openOfferVehicle: null,
    maxRideSeconds: null,
  }));
  const vehicles = Array.from({ length: trucks }, (_, k) => ({
    id: String(k),
    location: 0,
    availableAt: 0,
    endBy: Number.MAX_SAFE_INTEGER,
    seats: spec.seats,
    wheelchairSpaces: 0,
    stretcherSpaces: 0,
  }));
  return {
    policy: "heuristic",
    locations: [],
    matrix: world.matrix,
    vehicles,
    requests,
    shelters: [{ id: "shelter", location: 1, capacity: Number.MAX_SAFE_INTEGER }],
    timeLimitSeconds: 0,
  };
}

function everyoneInTime(solution: Solution, parties: Party[], homes: TruckHome[]) {
  if (solution.dropped.length > 0) return false;
  return solution.routes.every((route) =>
    route.stops.every((stop) => stop.kind !== "pickup" || stop.arrival <= homes[parties[Number(stop.request)].home].fireSeconds),
  );
}

// The fewest engines whose plan reaches every party before the fire, or null past the sweep.
function trucksNeeded(world: World, homes: TruckHome[], parties: Party[], spec: TruckSpec) {
  for (let trucks = 1; trucks <= MOST_TRUCKS_TRIED; trucks++) {
    if (everyoneInTime(solveHeuristic(problemFor(world, homes, parties, spec, trucks)), parties, homes)) return trucks;
  }
  return null;
}

// The pickup order the heuristic gave the one truck, collapsing its drop-offs into shelter visits.
function visitOrder(solution: Solution, parties: Party[]) {
  const visits: ({ kind: "pickup"; party: Party } | { kind: "shelter" })[] = [];
  for (const stop of solution.routes[0]?.stops ?? []) {
    if (stop.kind === "pickup") visits.push({ kind: "pickup", party: parties[Number(stop.request)] });
    else if (visits[visits.length - 1]?.kind !== "shelter") visits.push({ kind: "shelter" });
  }
  return visits;
}

class Drive {
  node: number;
  time = 0;
  onboard = 0;
  legs: Leg[] = [];
  stops: Stop[] = [];

  constructor(private world: World) {
    this.node = world.nodes[0];
  }

  // Drives to a node and returns the arrival time, or null when no road gets there.
  driveTo(node: number) {
    const edges = edgePath(shortestPathsFrom(this.node, new Set(), this.world.edgeTime), node);
    if (!edges) return null;
    if (edges.length > 0) {
      const { points, legSeconds } = legsFor(edges, this.world.edgeTime);
      this.legs.push({ startSeconds: this.time, path: points, legSeconds });
      this.time += legSeconds.reduce((sum, seconds) => sum + seconds, 0);
    }
    this.node = node;
    return this.time;
  }

  stop(kind: Stop["kind"], home: number | null, dwellSeconds: number) {
    this.stops.push({ kind, home, atSeconds: this.time, dwellSeconds, onboard: this.onboard });
    this.time += dwellSeconds;
  }
}

function emptyResults(homes: TruckHome[]): HomeResult[] {
  return homes.map(() => ({ reachedSeconds: null, outcome: "never_reached" }));
}

// A home is rescued when every party of it boarded; one party the fire beat makes it too late.
function recordArrival(results: HomeResult[], home: number, arrival: number, inTime: boolean) {
  const result = results[home];
  result.reachedSeconds = Math.max(result.reachedSeconds ?? 0, arrival);
  if (!inTime) result.outcome = "too_late";
  else if (result.outcome === "never_reached") result.outcome = "rescued";
}

// Parties of a home the truck never got to leave that home unfinished, so it can't count as rescued.
function unfinishedHomes(results: HomeResult[], parties: Party[], boarded: Set<Party>) {
  for (const party of parties) {
    const result = results[party.home];
    if (!boarded.has(party) && result.outcome === "rescued") result.outcome = "too_late";
  }
}

type Run = { world: World; homes: TruckHome[]; truck: Drive; results: HomeResult[]; boarded: Set<Party> };

function unloadAtShelter({ world, truck }: Run) {
  if (truck.onboard === 0 || truck.driveTo(world.nodes[1]) === null) return;
  truck.onboard = 0;
  truck.stop("unload", null, UNLOAD_SECONDS);
}

// Drives to a party's door. Before the fire it boards; after, the crew finds the fire got there first.
function callAt(run: Run, party: Party, horizon: number) {
  const home = run.homes[party.home];
  const arrival = run.truck.driveTo(run.world.nodes[party.home + 2]);
  if (arrival === null || arrival > horizon) return;
  const inTime = arrival <= home.fireSeconds;
  recordArrival(run.results, party.home, arrival, inTime);
  if (!inTime) return run.truck.stop("too_late", party.home, 0);
  run.boarded.add(party);
  run.truck.onboard += party.people;
  run.truck.stop("board", party.home, home.boardingSeconds);
}

export function runTruck(station: Point, shelter: Point, homes: TruckHome[], spec: TruckSpec = ENGINE): TruckRun {
  const world = buildWorld(station, shelter, homes, engineEdgeTime(spec.speedMph));
  const parties = partiesOf(homes, spec.seats);
  // The run ends when the fire has reached the last home on the list.
  const horizon = Math.max(0, ...homes.map((home) => home.fireSeconds));
  const run: Run = { world, homes, truck: new Drive(world), results: emptyResults(homes), boarded: new Set() };
  for (const visit of visitOrder(solveHeuristic(problemFor(world, homes, parties, spec, 1)), parties)) {
    if (run.truck.time >= horizon) break;
    if (visit.kind === "shelter") unloadAtShelter(run);
    else callAt(run, visit.party, horizon);
  }
  unloadAtShelter(run);
  unfinishedHomes(run.results, parties, run.boarded);
  const { legs, stops, time } = run.truck;
  return { legs, stops, homes: run.results, endSeconds: time, trucksNeeded: trucksNeeded(world, homes, parties, spec) };
}
