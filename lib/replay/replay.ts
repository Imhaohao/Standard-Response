import { LatLng } from "@/lib/geo";

// The replay log written by dispatch/sim/replay.py: one simulated night, every household and van.
// Times are whole seconds after the warning, coordinates integers in 1e-5 degrees.
export type ReplayFile = {
  version: 1;
  city: string;
  seed: number;
  fleet: number;
  warningAt: string;
  endS: number;
  kinds: string[];
  outcomes: string[];
  homes: { lat: number[]; lng: number[]; need: number[]; atRisk: number[]; hazardS: number[]; deadlineS: number[]; boardedS: number[]; outcome: number[] };
  events: [number, number, number, number][];
  plans: [number, number, number, number][];
  vehicles: { label: string; kind: "van" | "bus" | "ambulance" }[];
  points: number[];
  legs: [number, number, number[], number[]][];
  staging: { lat: number; lng: number };
  shelter: { lat: number; lng: number };
};

// What a household looks like at one moment of the night.
export type HomeState = "quiet" | "calling" | "noAnswer" | "leaving" | "needsRide" | "vanComing" | "aboard";

const STATE_OF_EVENT: Record<string, HomeState> = {
  call: "calling",
  noAnswer: "noAnswer",
  answer: "calling",
  text: "noAnswer",
  doorQueued: "noAnswer",
  clear: "leaving",
  request: "needsRide",
  accepted: "vanComing",
  cancel: "needsRide",
  expired: "needsRide",
  noRoad: "needsRide",
  pickup: "aboard",
};

// A home's changes of state, earliest first, as parallel arrays so a lookup is a binary search.
type Timeline = { at: number[]; state: HomeState[] };

type Leg = { vehicle: number; start: number; end: number; path: LatLng[]; offsets: number[] };

export type Replay = {
  file: ReplayFile;
  homes: LatLng[];
  timelines: Timeline[];
  legsByVehicle: Leg[][];
  staging: LatLng;
  shelter: LatLng;
};

const E5 = 1e-5;
const toLatLng = (lat: number, lng: number): LatLng => ({ lat: lat * E5, lng: lng * E5 });

function pushState(timeline: Timeline, at: number, state: HomeState) {
  const last = timeline.state.length - 1;
  if (last >= 0 && timeline.state[last] === state) return;
  if (last >= 0 && timeline.state[last] === "aboard") return;
  timeline.at.push(at);
  timeline.state.push(state);
}

function buildTimelines(file: ReplayFile): Timeline[] {
  const timelines: Timeline[] = file.homes.lat.map(() => ({ at: [], state: [] }));
  for (const [at, kind, home] of file.events) {
    const state = STATE_OF_EVENT[file.kinds[kind]];
    if (home < 0 || !state) continue;
    pushState(timelines[home], at, state);
  }
  return timelines;
}

function buildLegs(file: ReplayFile): Leg[][] {
  const byVehicle: Leg[][] = file.vehicles.map(() => []);
  for (const [vehicle, start, indices, offsets] of file.legs) {
    const path = indices.map((i) => toLatLng(file.points[i * 2], file.points[i * 2 + 1]));
    byVehicle[vehicle].push({ vehicle, start, end: start + offsets[offsets.length - 1], path, offsets });
  }
  return byVehicle;
}

export function decodeReplay(file: ReplayFile): Replay {
  return {
    file,
    homes: file.homes.lat.map((lat, i) => toLatLng(lat, file.homes.lng[i])),
    timelines: buildTimelines(file),
    legsByVehicle: buildLegs(file),
    staging: toLatLng(file.staging.lat, file.staging.lng),
    shelter: toLatLng(file.shelter.lat, file.shelter.lng),
  };
}

// The last index in a sorted array whose value is at or before t, or -1.
function lastAtOrBefore(values: number[], t: number) {
  let [low, high] = [0, values.length - 1];
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= t) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

export function homeStateAt(replay: Replay, home: number, seconds: number): HomeState {
  const timeline = replay.timelines[home];
  const index = lastAtOrBefore(timeline.at, seconds);
  return index < 0 ? "quiet" : timeline.state[index];
}

function along(leg: Leg, seconds: number): LatLng {
  const elapsed = seconds - leg.start;
  const step = Math.max(1, lastAtOrBefore(leg.offsets, elapsed) + 1);
  if (step >= leg.path.length) return leg.path[leg.path.length - 1];
  const [t0, t1] = [leg.offsets[step - 1], leg.offsets[step]];
  const share = t1 > t0 ? (elapsed - t0) / (t1 - t0) : 1;
  const [a, b] = [leg.path[step - 1], leg.path[step]];
  return { lat: a.lat + (b.lat - a.lat) * share, lng: a.lng + (b.lng - a.lng) * share };
}

export type VanAt = { vehicle: number; at: LatLng; driving: boolean; ahead: LatLng[] };

// Where a van is: on its street path while a leg runs, else parked where its last leg ended.
export function vanAt(replay: Replay, vehicle: number, seconds: number): VanAt {
  const legs = replay.legsByVehicle[vehicle];
  const index = lastAtOrBefore(legs.map((leg) => leg.start), seconds);
  if (index < 0) return { vehicle, at: replay.staging, driving: false, ahead: [] };
  const leg = legs[index];
  if (seconds >= leg.end) return { vehicle, at: leg.path[leg.path.length - 1], driving: false, ahead: [] };
  const at = along(leg, seconds);
  const next = lastAtOrBefore(leg.offsets, seconds - leg.start) + 1;
  return { vehicle, at, driving: true, ahead: [at, ...leg.path.slice(next)] };
}

// What a household in the hazard's path looks like at one moment. Homes outside it, and homes that never needed a
// ride, have no risk state and draw nothing.
export type RiskState = "waiting" | "vanComing" | "out" | "missed";

export function riskStateAt(replay: Replay, home: number, seconds: number): RiskState | null {
  const { homes } = replay.file;
  if (!homes.atRisk[home] || homes.need[home] === 0) return null;
  const boarded = homes.boardedS[home];
  if (boarded >= 0 && boarded <= seconds) return "out";
  if (homes.hazardS[home] >= 0 && seconds >= homes.hazardS[home]) return "missed";
  const state = homeStateAt(replay, home, seconds);
  if (state === "needsRide") return "waiting";
  return state === "vanComing" ? "vanComing" : null;
}

// Every home with a risk state at this moment, by home index.
export function riskStates(replay: Replay, seconds: number): Map<number, RiskState> {
  const states = new Map<number, RiskState>();
  for (let home = 0; home < replay.homes.length; home++) {
    const state = riskStateAt(replay, home, seconds);
    if (state) states.set(home, state);
  }
  return states;
}

export type ReplayCount = { outOnTime: number; waiting: number; missed: number; atRisk: number };

const isWaiting = (state: RiskState | undefined) => state === "waiting" || state === "vanComing";

// Out on time: homes in the hazard's path whose whole party boarded by the deadline, counted from that moment.
// Waiting: homes in its path that asked for a ride, aren't aboard, and the hazard hasn't reached yet.
// Missed: homes in its path the hazard reached before their party was aboard.
export function countAt(replay: Replay, seconds: number): ReplayCount {
  const { homes } = replay.file;
  const states = riskStates(replay, seconds);
  let [outOnTime, waiting, missed, atRisk] = [0, 0, 0, 0];
  for (let i = 0; i < homes.atRisk.length; i++) {
    if (!homes.atRisk[i] || homes.need[i] === 0) continue;
    atRisk++;
    const state = states.get(i);
    if (state === "out" && homes.boardedS[i] <= homes.deadlineS[i]) outOnTime++;
    if (isWaiting(state)) waiting++;
    if (state === "missed") missed++;
  }
  return { outOnTime, waiting, missed, atRisk };
}
