import { DEADLINE_MARGIN_MINUTES } from "@/convex/model";
import { ENGINE } from "@/convex/vehicleRun";
import { LatLng } from "../geo";
import { Point } from "./data";

// Fire crews working the night on the rescue map: engines leave real stations at the warning and
// go door to door in the fire's path in the door-check list's order (the score in
// modeling/rollcall_d/door.py that data/door-fairness.json measures), so they visibly race the front. The whole night is planned at once from the homes and the fire on screen, and the map
// plays it back on the fire's clock. It is a playback: nothing here writes to any household.

// Each city's fire stations, by city id (lib/cities.ts). Altadena's are LA County Fire stations at
// their LA County locator addresses; the points are approximate. Station 19 in La Cañada Flintridge
// sits off the baked map, so its engine joins where it first reaches the streets.
export type Station = { name: string; engine: string; at: LatLng };
export const FIRE_STATIONS: Record<string, Station[]> = {
  altadena: [
    { name: "Station 12, Lincoln Ave", engine: "Engine 12", at: { lat: 34.1916, lng: -118.1586 } },
    { name: "Station 11, El Molino Ave", engine: "Engine 11", at: { lat: 34.1876, lng: -118.1363 } },
    { name: "Station 82, Foothill Blvd", engine: "Engine 82", at: { lat: 34.2049, lng: -118.1985 } },
    { name: "Station 19, Foothill Blvd", engine: "Engine 19", at: { lat: 34.2146, lng: -118.2218 } },
  ],
};

const METERS_PER_MILE = 1609.344;
// The truck drill's engine speed (convex/vehicleRun.ts ENGINE): well under the limit in an evacuation.
export const CREW_METERS_PER_MINUTE = (ENGINE.speedMph * METERS_PER_MILE) / 60;
// Out the door after the call: a staffed engine is rolling within two minutes.
export const TURNOUT_MINUTES = 2;
// Streets wander, so a straight line understates the drive. Used only to rank homes before routing.
export const STREET_DETOUR = 1.4;
// A crew leaves a door at least this long before the fire gets there.
const SAFETY_MINUTES = 3;
// The door-check score's floors (MIN_SLACK_MINUTES and MIN_TRAVEL_MINUTES in modeling/rollcall_d/door.py).
const MIN_SLACK_MINUTES = 5;
const MIN_TRAVEL_MINUTES = 1;

// `joinsAtEdge`: the station is off the map, so the engine appears where it reaches the streets.
export type CrewStart = { engine: string; station: string; at: Point; leavesAt: number; joinsAtEdge: boolean };
export type CrewHome = { id: string; at: Point; fireMinutes: number; dwellMinutes: number; need: number };
export type CrewLeg = { startMinutes: number; endMinutes: number; path: Point[]; meters: number[] };
export type CrewVisit = { home: string; at: Point; arriveMinutes: number; leaveMinutes: number; fireMinutes: number };
export type CrewRun = CrewStart & { legs: CrewLeg[]; visits: CrewVisit[] };
// Streets from one place to another, or null when no street joins them.
export type DriveRoute = (from: Point, to: Point) => Point[] | null;

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function legAlong(path: Point[], startMinutes: number, metersPerMinute: number): CrewLeg {
  const meters = [0];
  for (let i = 1; i < path.length; i++) meters.push(meters[i - 1] + distance(path[i - 1], path[i]));
  return { startMinutes, endMinutes: startMinutes + meters[meters.length - 1] / metersPerMinute, path, meters };
}

type Crew = { run: CrewRun; at: Point; time: number; done: boolean };
type Planner = { homes: CrewHome[]; claimed: Set<string>; drive: DriveRoute; metersPerMinute: number };

// door.py's need_urgency_term: need, times 60 over the minutes left before the deadline, over the drive.
// Its aging term is left out: every home here joins the list at the warning, so all of them have
// waited equally long at any pick and aging can't change which one wins.
export function doorScore(need: number, minutesToFire: number, driveMinutes: number) {
  const urgency = 60 / Math.max(minutesToFire - DEADLINE_MARGIN_MINUTES, MIN_SLACK_MINUTES);
  return (need * urgency) / Math.max(driveMinutes, MIN_TRAVEL_MINUTES);
}

// Higher goes first. A home the crew can't leave before the fire, with time to spare, isn't a candidate.
function rank(crew: Crew, home: CrewHome, metersPerMinute: number) {
  const driveMinutes = (distance(crew.at, home.at) * STREET_DETOUR) / metersPerMinute;
  if (crew.time + driveMinutes + home.dwellMinutes > home.fireMinutes - SAFETY_MINUTES) return null;
  return doorScore(home.need, home.fireMinutes - crew.time, driveMinutes);
}

function bestHome(crew: Crew, planner: Planner, passed: Set<string>) {
  let best: CrewHome | null = null;
  let bestScore = -Infinity;
  for (const home of planner.homes) {
    if (planner.claimed.has(home.id) || passed.has(home.id)) continue;
    const score = rank(crew, home, planner.metersPerMinute);
    if (score !== null && score > bestScore) [best, bestScore] = [home, score];
  }
  return best;
}

// Routes the best-ranked home by street; one the real drive makes too late is passed over for the next.
function nextVisit(crew: Crew, planner: Planner) {
  const passed = new Set<string>();
  for (let home = bestHome(crew, planner, passed); home; home = bestHome(crew, planner, passed)) {
    const path = planner.drive(crew.at, home.at);
    const leg = path ? legAlong(path, crew.time, planner.metersPerMinute) : null;
    if (leg && leg.endMinutes + home.dwellMinutes <= home.fireMinutes - SAFETY_MINUTES) return { home, leg };
    passed.add(home.id);
  }
  return null;
}

function goHome(crew: Crew, planner: Planner) {
  crew.done = true;
  const path = distance(crew.at, crew.run.at) > 1 ? planner.drive(crew.at, crew.run.at) : null;
  if (path) crew.run.legs.push(legAlong(path, crew.time, planner.metersPerMinute));
}

function step(crew: Crew, planner: Planner) {
  const next = nextVisit(crew, planner);
  if (!next) return goHome(crew, planner);
  const { home, leg } = next;
  planner.claimed.add(home.id);
  crew.run.legs.push(leg);
  const arriveMinutes = leg.endMinutes;
  const leaveMinutes = arriveMinutes + home.dwellMinutes;
  crew.run.visits.push({ home: home.id, at: home.at, arriveMinutes, leaveMinutes, fireMinutes: home.fireMinutes });
  crew.at = home.at;
  crew.time = leaveMinutes;
}

// The crew free soonest picks next; ties go to the order the stations are listed, so a night always plans the same.
function soonestFree(crews: Crew[]) {
  let soonest: Crew | null = null;
  for (const crew of crews) if (!crew.done && (!soonest || crew.time < soonest.time)) soonest = crew;
  return soonest;
}

export function planCrews(starts: CrewStart[], homes: CrewHome[], drive: DriveRoute, metersPerMinute = CREW_METERS_PER_MINUTE): CrewRun[] {
  const ordered = [...homes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const planner: Planner = { homes: ordered, claimed: new Set(), drive, metersPerMinute };
  const crews: Crew[] = starts.map((start) => ({ run: { ...start, legs: [], visits: [] }, at: start.at, time: start.leavesAt, done: false }));
  for (let crew = soonestFree(crews); crew; crew = soonestFree(crews)) step(crew, planner);
  return crews.map((crew) => crew.run);
}

// ---- Playback ----

export type CrewMoment =
  | { kind: "waiting"; at: Point }
  | { kind: "driving"; at: Point; leg: CrewLeg; ahead: Point[]; to: CrewVisit | null }
  | { kind: "helping"; at: Point; visit: CrewVisit; progress: number }
  | { kind: "done"; at: Point };

function pointAlong(leg: CrewLeg, meters: number): { at: Point; index: number } {
  let i = 1;
  while (i < leg.meters.length - 1 && leg.meters[i] < meters) i++;
  const span = leg.meters[i] - leg.meters[i - 1];
  const t = span === 0 ? 1 : Math.min(1, Math.max(0, (meters - leg.meters[i - 1]) / span));
  const [a, b] = [leg.path[i - 1], leg.path[i]];
  return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: i };
}

function driving(run: CrewRun, leg: CrewLeg, minutes: number): CrewMoment {
  const total = leg.meters[leg.meters.length - 1];
  const share = leg.endMinutes === leg.startMinutes ? 1 : (minutes - leg.startMinutes) / (leg.endMinutes - leg.startMinutes);
  const { at, index } = pointAlong(leg, total * share);
  const to = run.visits.find((visit) => visit.arriveMinutes === leg.endMinutes) ?? null;
  return { kind: "driving", at, leg, ahead: [at, ...leg.path.slice(index)], to };
}

// Where a crew is at a minute after the warning, and what it is doing there.
export function crewAt(run: CrewRun, minutes: number): CrewMoment {
  if (minutes < run.leavesAt) return { kind: "waiting", at: run.at };
  const leg = run.legs.find((candidate) => candidate.startMinutes <= minutes && minutes < candidate.endMinutes);
  if (leg) return driving(run, leg, minutes);
  const visit = run.visits.find((candidate) => candidate.arriveMinutes <= minutes && minutes < candidate.leaveMinutes);
  if (visit) return { kind: "helping", at: visit.at, visit, progress: (minutes - visit.arriveMinutes) / (visit.leaveMinutes - visit.arriveMinutes) };
  const lastLeg = run.legs.at(-1);
  return { kind: "done", at: lastLeg ? lastLeg.path[lastLeg.path.length - 1] : run.at };
}

// Every home the crews have left by a minute after the warning.
export function visitedBy(runs: CrewRun[], minutes: number) {
  return runs.flatMap((run) => run.visits.filter((visit) => visit.leaveMinutes <= minutes));
}
