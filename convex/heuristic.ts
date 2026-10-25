import type { PlannedStop, Problem, ProblemRequest, ProblemVehicle, Solution } from "./dispatchProblem";
import { Load, UNLOAD_SECONDS } from "./vehicleRun";

// The competent heuristic: earliest deadline first, type and crew matched, greedy insertion after
// each vehicle's accepted run. The baseline OR-Tools must beat and the fallback dispatcher when the
// solver service is down. dispatch/heuristic.py is the simulator's copy; keep the two in step.
//
// Each vehicle carries riders in trips: pickups, then one shelter. A rider reserves space for their
// whole party at the nearest shelter with room, and joins the open trip only when it fits, the
// trip's shelter still has room, and everyone's ride time stays legal; otherwise the vehicle drops
// off first. The rider goes to the compatible vehicle that reaches them soonest. Riders no vehicle
// can reach before their deadline wait until everyone reachable in time is placed, like a
// dispatcher's triage. A rider with no road to a shelter that has room can't be served. A rider
// whose driver can no longer reach them was told they're still at the top of the list, so riders
// being reassigned go first, earliest deadline first among them.

const LOAD_FIELDS = ["seats", "wheelchairSpaces", "stretcherSpaces"] as const;

const partySize = (load: Load) => LOAD_FIELDS.reduce((sum, field) => sum + load[field], 0);

type Trip = { request: ProblemRequest; pickedUpAt: number }[];

type VehicleState = {
  vehicle: ProblemVehicle;
  location: number;
  time: number;
  trip: Trip;
  tripShelter: number | null;
  stops: PlannedStop[];
};

// Room left at each shelter, reserved as riders are assigned.
class Shelters {
  room: number[];

  constructor(readonly problem: Problem) {
    this.room = problem.shelters.map((shelter) => shelter.capacity);
  }

  seconds(location: number, s: number) {
    return this.problem.matrix[location][this.problem.shelters[s].location];
  }

  nearestWithRoom(location: number, party: number) {
    let best: { index: number; seconds: number } | null = null;
    for (const [index, room] of this.room.entries()) {
      const seconds = this.seconds(location, index);
      if (seconds !== null && room >= party && (best === null || seconds < best.seconds)) best = { index, seconds };
    }
    return best;
  }
}

const fitsEmpty = (vehicle: ProblemVehicle, load: Load) => LOAD_FIELDS.every((field) => load[field] <= vehicle[field]);

function fitsTrip(state: VehicleState, load: Load) {
  return LOAD_FIELDS.every(
    (field) => state.trip.reduce((sum, rider) => sum + rider.request.load[field], 0) + load[field] <= state.vehicle[field],
  );
}

function rideTimesLegal(shelters: Shelters, state: VehicleState, request: ProblemRequest, arrival: number, s: number) {
  const toShelter = shelters.seconds(request.location, s);
  if (toShelter === null) return false;
  const dropAt = arrival + request.boardingSeconds + toShelter;
  const riders = [...state.trip, { request, pickedUpAt: arrival }];
  return riders.every(({ request: r, pickedUpAt }) => r.maxRideSeconds === null || dropAt - pickedUpAt <= r.maxRideSeconds);
}

type Option = { vehicle: number; arrival: number; joinsTrip: boolean; shelter: number };

function joinOpenTrip(problem: Problem, shelters: Shelters, state: VehicleState, k: number, request: ProblemRequest): Option | null {
  const s = state.tripShelter;
  if (state.trip.length === 0 || s === null || !fitsTrip(state, request.load)) return null;
  if (shelters.room[s] < partySize(request.load)) return null;
  const seconds = problem.matrix[state.location][request.location];
  if (seconds === null || !rideTimesLegal(shelters, state, request, state.time + seconds, s)) return null;
  return { vehicle: k, arrival: state.time + seconds, joinsTrip: true, shelter: s };
}

// Where and when the vehicle is free after delivering its open trip.
function afterDropOff(shelters: Shelters, state: VehicleState) {
  if (state.trip.length === 0 || state.tripShelter === null) return { location: state.location, time: state.time };
  const seconds = shelters.seconds(state.location, state.tripShelter);
  if (seconds === null) return null;
  return { location: shelters.problem.shelters[state.tripShelter].location, time: state.time + seconds + UNLOAD_SECONDS };
}

function startNewTrip(problem: Problem, shelters: Shelters, state: VehicleState, k: number, request: ProblemRequest): Option | null {
  const ready = afterDropOff(shelters, state);
  const shelter = shelters.nearestWithRoom(request.location, partySize(request.load));
  if (!ready || !shelter || !fitsEmpty(state.vehicle, request.load)) return null;
  const seconds = problem.matrix[ready.location][request.location];
  return seconds === null ? null : { vehicle: k, arrival: ready.time + seconds, joinsTrip: false, shelter: shelter.index };
}

function dropOff(shelters: Shelters, state: VehicleState) {
  if (state.trip.length === 0 || state.tripShelter === null) return;
  const s = state.tripShelter;
  state.time += shelters.seconds(state.location, s) ?? 0;
  for (const { request } of state.trip) {
    state.stops.push({ request: request.id, kind: "dropoff", shelter: shelters.problem.shelters[s].id, arrival: state.time });
  }
  state.time += UNLOAD_SECONDS;
  state.location = shelters.problem.shelters[s].location;
  state.trip = [];
  state.tripShelter = null;
}

function assign(shelters: Shelters, state: VehicleState, request: ProblemRequest, option: Option) {
  if (!option.joinsTrip) {
    dropOff(shelters, state);
    state.tripShelter = option.shelter;
  }
  shelters.room[option.shelter] -= partySize(request.load);
  state.stops.push({ request: request.id, kind: "pickup", shelter: null, arrival: option.arrival });
  state.trip.push({ request, pickedUpAt: option.arrival });
  state.location = request.location;
  state.time = option.arrival + request.boardingSeconds;
}

function bestOption(problem: Problem, shelters: Shelters, states: VehicleState[], request: ProblemRequest) {
  const options = request.allowedVehicles
    .map((k) => joinOpenTrip(problem, shelters, states[k], k, request) ?? startNewTrip(problem, shelters, states[k], k, request))
    .filter((option): option is Option => option !== null && option.arrival <= states[option.vehicle].vehicle.endBy);
  return options.sort((a, b) => a.arrival - b.arrival)[0];
}

type Placing = { problem: Problem; shelters: Shelters; states: VehicleState[]; dropped: string[] };

function place(placing: Placing, requests: ProblemRequest[], late?: ProblemRequest[]) {
  for (const request of requests) {
    const best = bestOption(placing.problem, placing.shelters, placing.states, request);
    if (!best) placing.dropped.push(request.id);
    else if (late && best.arrival > request.deadline) late.push(request);
    else assign(placing.shelters, placing.states[best.vehicle], request, best);
  }
}

export function solveHeuristic(problem: Problem): Solution {
  const started = Date.now();
  const shelters = new Shelters(problem);
  const states: VehicleState[] = problem.vehicles.map((vehicle) => ({
    vehicle,
    location: vehicle.location,
    time: vehicle.availableAt,
    trip: [],
    tripShelter: null,
    stops: [],
  }));
  const placing: Placing = { problem, shelters, states, dropped: [] };
  const late: ProblemRequest[] = [];
  const order = (a: ProblemRequest, b: ProblemRequest) => Number(Boolean(b.reassigned)) - Number(Boolean(a.reassigned)) || a.deadline - b.deadline;
  place(placing, [...problem.requests].sort(order), late);
  place(placing, late);
  for (const state of states) dropOff(shelters, state);
  return {
    routes: states.map((state) => ({ vehicle: state.vehicle.id, stops: state.stops })),
    dropped: placing.dropped,
    solver: "heuristic",
    solveMs: Date.now() - started,
  };
}
