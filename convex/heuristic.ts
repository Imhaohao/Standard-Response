import type { PlannedStop, Problem, ProblemRequest, ProblemVehicle, Solution } from "./dispatchProblem";
import { Load, UNLOAD_SECONDS } from "./vehicleRun";

// The competent heuristic: earliest deadline first, type and crew matched, greedy insertion after
// each vehicle's accepted run. The baseline OR-Tools must beat and the fallback dispatcher when the
// solver service is down. dispatch/heuristic.py is the simulator's copy; keep the two in step.
//
// A vehicle carries riders in trips: pickups, then the nearest shelter. A rider joins the open trip
// when they fit and every rider's ride time stays legal; otherwise the vehicle drops off first.
// Each rider goes to the compatible vehicle that reaches them soonest.

const LOAD_FIELDS = ["seats", "wheelchairSpaces", "stretcherSpaces"] as const;

type Trip = { request: ProblemRequest; pickedUpAt: number }[];

type VehicleState = { vehicle: ProblemVehicle; location: number; time: number; trip: Trip; stops: PlannedStop[] };

function nearestShelter(problem: Problem, location: number) {
  let best: { index: number; seconds: number } | null = null;
  for (const [index, shelter] of problem.shelters.entries()) {
    const seconds = problem.matrix[location][shelter.location];
    if (seconds !== null && (best === null || seconds < best.seconds)) best = { index, seconds };
  }
  return best;
}

const fitsEmpty = (vehicle: ProblemVehicle, load: Load) => LOAD_FIELDS.every((field) => load[field] <= vehicle[field]);

function fitsTrip(state: VehicleState, load: Load) {
  return LOAD_FIELDS.every(
    (field) => state.trip.reduce((sum, rider) => sum + rider.request.load[field], 0) + load[field] <= state.vehicle[field],
  );
}

function rideTimesLegal(problem: Problem, state: VehicleState, request: ProblemRequest, arrival: number) {
  const shelter = nearestShelter(problem, request.location);
  if (!shelter) return false;
  const dropAt = arrival + request.boardingSeconds + shelter.seconds;
  const riders = [...state.trip, { request, pickedUpAt: arrival }];
  return riders.every(({ request: r, pickedUpAt }) => r.maxRideSeconds === null || dropAt - pickedUpAt <= r.maxRideSeconds);
}

function joinOpenTrip(problem: Problem, state: VehicleState, request: ProblemRequest) {
  if (state.trip.length === 0 || !fitsTrip(state, request.load)) return null;
  const seconds = problem.matrix[state.location][request.location];
  if (seconds === null || !rideTimesLegal(problem, state, request, state.time + seconds)) return null;
  return state.time + seconds;
}

function afterDropOff(problem: Problem, state: VehicleState) {
  if (state.trip.length === 0) return { location: state.location, time: state.time };
  const shelter = nearestShelter(problem, state.location);
  if (!shelter) return null;
  return { location: problem.shelters[shelter.index].location, time: state.time + shelter.seconds + UNLOAD_SECONDS };
}

function startNewTrip(problem: Problem, state: VehicleState, request: ProblemRequest) {
  const ready = afterDropOff(problem, state);
  if (!ready || !fitsEmpty(state.vehicle, request.load)) return null;
  const seconds = problem.matrix[ready.location][request.location];
  return seconds === null ? null : ready.time + seconds;
}

type Option = { vehicle: number; arrival: number; joinsTrip: boolean };

function optionFor(problem: Problem, states: VehicleState[], k: number, request: ProblemRequest): Option | null {
  const joined = joinOpenTrip(problem, states[k], request);
  if (joined !== null) return { vehicle: k, arrival: joined, joinsTrip: true };
  const fresh = startNewTrip(problem, states[k], request);
  return fresh === null ? null : { vehicle: k, arrival: fresh, joinsTrip: false };
}

function dropOff(problem: Problem, state: VehicleState) {
  if (state.trip.length === 0) return;
  const shelter = nearestShelter(problem, state.location)!;
  state.time += shelter.seconds;
  for (const { request } of state.trip) {
    state.stops.push({ request: request.id, kind: "dropoff", shelter: problem.shelters[shelter.index].id, arrival: state.time });
  }
  state.time += UNLOAD_SECONDS;
  state.location = problem.shelters[shelter.index].location;
  state.trip = [];
}

function assign(problem: Problem, state: VehicleState, request: ProblemRequest, option: Option) {
  if (!option.joinsTrip) dropOff(problem, state);
  state.stops.push({ request: request.id, kind: "pickup", shelter: null, arrival: option.arrival });
  state.trip.push({ request, pickedUpAt: option.arrival });
  state.location = request.location;
  state.time = option.arrival + request.boardingSeconds;
}

export function solveHeuristic(problem: Problem): Solution {
  const started = Date.now();
  const states: VehicleState[] = problem.vehicles.map((vehicle) => ({
    vehicle,
    location: vehicle.location,
    time: vehicle.availableAt,
    trip: [],
    stops: [],
  }));
  const dropped: string[] = [];
  for (const request of [...problem.requests].sort((a, b) => a.deadline - b.deadline)) {
    const options = request.allowedVehicles
      .map((k) => optionFor(problem, states, k, request))
      .filter((option): option is Option => option !== null && option.arrival <= states[option.vehicle].vehicle.endBy);
    const best = options.sort((a, b) => a.arrival - b.arrival)[0];
    if (!best) {
      dropped.push(request.id);
      continue;
    }
    assign(problem, states[best.vehicle], request, best);
  }
  for (const state of states) dropOff(problem, state);
  return {
    routes: states.map((state) => ({ vehicle: state.vehicle.id, stops: state.stops })),
    dropped,
    solver: "heuristic",
    solveMs: Date.now() - started,
  };
}
