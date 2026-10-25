// How a vehicle works through its accepted run. Vehicle movement and the re-planner both use this,
// so the ETA a rider hears matches where the van actually goes.
//
// Rule: visit accepted pickups in stop order. Drive to the shelter first when the next rider
// doesn't fit, and after the last pickup.

export const UNLOAD_SECONDS = 120;

// Simulated vehicles drive and board this many times faster than real time, so a run finishes
// during a demo. ETAs, deadlines and the solver all stay in real minutes. Label it on screen.
export const SIMULATED_TIME_LAPSE = 4;

// The one-truck drill's fire engine (convex/truckRun.ts). A type 1 engine's cab seats six and LA County
// staffs it with four, which leaves two seats. In an evacuation the engine averages well under the
// limit: narrow streets, cars leaving, smoke.
export type TruckSpec = { speedMph: number; seats: number };
export const ENGINE: TruckSpec = { speedMph: 20, seats: 2 };
// The furthest the drill looks for how many engines it would take to reach everyone in time.
export const MOST_TRUCKS_TRIED = 20;

export type Load = { seats: number; wheelchairSpaces: number; stretcherSpaces: number };
const LOAD_FIELDS = ["seats", "wheelchairSpaces", "stretcherSpaces"] as const;

export type RunPickup<Id> = { id: Id; node: number; load: Load; boardingSeconds: number };
export type RunState<Id> = { node: number; onboard: Load[]; pickups: RunPickup<Id>[]; capacity: Load };
export type NextStop<Id> = { kind: "pickup"; pickup: RunPickup<Id> } | { kind: "shelter" } | null;

function fits(capacity: Load, onboard: Load[], extra: Load) {
  return LOAD_FIELDS.every((field) => onboard.reduce((sum, l) => sum + l[field], 0) + extra[field] <= capacity[field]);
}

export function nextStop<Id>(state: RunState<Id>): NextStop<Id> {
  const [pickup] = state.pickups;
  if (pickup && (state.onboard.length === 0 || fits(state.capacity, state.onboard, pickup.load))) {
    return { kind: "pickup", pickup };
  }
  return state.onboard.length > 0 ? { kind: "shelter" } : null;
}

export type Travel = (from: number, to: number) => number | null;
export type ShelterFor = (from: number) => { node: number; seconds: number } | null;

export type RunForecast<Id> = {
  // Seconds from now until the vehicle reaches each accepted pickup; null when no route reaches it.
  arrivals: Map<Id, number | null>;
  endNode: number;
  endSeconds: number;
};

// Walks the accepted run forward in time. An unreachable pickup is skipped so the rest still gets a forecast.
export function forecastRun<Id>(start: RunState<Id>, startSeconds: number, travel: Travel, shelterFor: ShelterFor) {
  const state: RunState<Id> = { ...start, onboard: [...start.onboard], pickups: [...start.pickups] };
  const forecast: RunForecast<Id> = { arrivals: new Map(), endNode: state.node, endSeconds: startSeconds };
  let time = startSeconds;
  for (let stop = nextStop(state); stop; stop = nextStop(state)) {
    if (stop.kind === "pickup") {
      state.pickups.shift();
      const seconds = travel(state.node, stop.pickup.node);
      forecast.arrivals.set(stop.pickup.id, seconds === null ? null : time + seconds);
      if (seconds === null) continue;
      time += seconds + stop.pickup.boardingSeconds;
      state.node = stop.pickup.node;
      state.onboard.push(stop.pickup.load);
      continue;
    }
    const shelter = shelterFor(state.node);
    if (!shelter) {
      // Boxed in by closures: no shelter and none of the remaining pickups can be reached from here.
      for (const pickup of state.pickups) forecast.arrivals.set(pickup.id, null);
      break;
    }
    time += shelter.seconds + UNLOAD_SECONDS;
    state.node = shelter.node;
    state.onboard = [];
  }
  return { ...forecast, endNode: state.node, endSeconds: time };
}

// Where a vehicle is after driving `progress` road seconds along a path split into legs.
export function positionAt(route: { path: { lat: number; lng: number }[]; legSeconds: number[] }, progress: number) {
  let elapsed = 0;
  for (const [i, seconds] of route.legSeconds.entries()) {
    if (elapsed + seconds >= progress) {
      const fraction = seconds === 0 ? 1 : (progress - elapsed) / seconds;
      const [a, b] = [route.path[i], route.path[i + 1]];
      return { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction };
    }
    elapsed += seconds;
  }
  return route.path[route.path.length - 1];
}
