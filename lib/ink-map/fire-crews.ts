import { ENGINE } from "@/convex/vehicleRun";
import { LatLng } from "../geo";
import { Point } from "./data";

// Fire crews working the night on the rescue map. Engines leave real stations and take homes off
// the door-check list (convex/doorChecks.ts `queue`) in its order: a crew that comes free takes the
// highest-ranked home no other crew has taken, unless it can't get there and leave 3 minutes before
// the fire. The list is live, so the plan reads it as a timeline: each decision sees the list as it
// stood at that minute, and a change only affects decisions after it. It is a playback: nothing here
// writes to any household.

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
// Streets wander, so a straight line understates the drive. Used for the off-map station's approach.
export const STREET_DETOUR = 1.4;
// A crew leaves a door at least this long before the fire gets there.
export const SAFETY_MINUTES = 3;

// `joinsAtEdge`: the station is off the map, so the engine appears where it reaches the streets.
export type CrewStart = { engine: string; station: string; at: Point; leavesAt: number; joinsAtEdge: boolean };
// `fireMinutes` is Infinity for a listed home the fire never reaches.
export type CrewHome = { id: string; at: Point; fireMinutes: number; dwellMinutes: number };
// The door-check list from a minute after the warning until the next snapshot, top of the list first.
export type QueueSnapshot = { fromMinutes: number; homes: CrewHome[] };
export type CrewLeg = { startMinutes: number; endMinutes: number; path: Point[]; meters: number[] };
// `sentMinutes`: when the crew set off for the door, which from then on is its to finish.
export type CrewVisit = { home: string; at: Point; sentMinutes: number; arriveMinutes: number; leaveMinutes: number; fireMinutes: number };
// A listed home a free crew passed over for a lower one, because it couldn't reach it in time.
export type PassedHome = { home: string; atMinutes: number };
export type CrewRun = CrewStart & { legs: CrewLeg[]; visits: CrewVisit[]; passed: PassedHome[] };
// Streets from one place to another, or null when no street joins them.
export type DriveRoute = (from: Point, to: Point) => Point[] | null;

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const AT_STATION_METERS = 1;

function legAlong(path: Point[], startMinutes: number, metersPerMinute: number): CrewLeg {
  const meters = [0];
  for (let i = 1; i < path.length; i++) meters.push(meters[i - 1] + distance(path[i - 1], path[i]));
  return { startMinutes, endMinutes: startMinutes + meters[meters.length - 1] / metersPerMinute, path, meters };
}

function pointAlong(leg: CrewLeg, meters: number): { at: Point; index: number } {
  let i = 1;
  while (i < leg.meters.length - 1 && leg.meters[i] < meters) i++;
  const span = leg.meters[i] - leg.meters[i - 1];
  const t = span === 0 ? 1 : Math.min(1, Math.max(0, (meters - leg.meters[i - 1]) / span));
  const [a, b] = [leg.path[i - 1], leg.path[i]];
  return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: i };
}

const shareAt = (leg: CrewLeg, minutes: number) => (leg.endMinutes === leg.startMinutes ? 1 : (minutes - leg.startMinutes) / (leg.endMinutes - leg.startMinutes));

// The part of a leg driven by a minute: a crew heading back to its station turns around there.
function cutLeg(leg: CrewLeg, minutes: number): CrewLeg {
  const meters = leg.meters[leg.meters.length - 1] * shareAt(leg, minutes);
  const { at, index } = pointAlong(leg, meters);
  return { startMinutes: leg.startMinutes, endMinutes: minutes, path: [...leg.path.slice(0, index), at], meters: [...leg.meters.slice(0, index), meters] };
}

type Crew = { run: CrewRun; at: Point; time: number; done: boolean };
type Planner = { queue: QueueSnapshot[]; claimed: Set<string>; drive: DriveRoute; metersPerMinute: number };

// The list as it stood at a minute: the latest snapshot from at or before it.
function queueAt(queue: QueueSnapshot[], minutes: number) {
  let homes: CrewHome[] = [];
  for (const snapshot of queue) {
    if (snapshot.fromMinutes > minutes) break;
    homes = snapshot.homes;
  }
  return homes;
}

const nextChange = (queue: QueueSnapshot[], minutes: number) => queue.find((snapshot) => snapshot.fromMinutes > minutes)?.fromMinutes ?? Infinity;
const leavesInTime = (arriveMinutes: number, home: CrewHome) => arriveMinutes + home.dwellMinutes <= home.fireMinutes - SAFETY_MINUTES;

// The street drive to a home, or null when the crew can't get there and leave in time. No street is
// shorter than the straight line, so a home too late even by that is passed without routing.
function driveTo(crew: Crew, home: CrewHome, planner: Planner) {
  if (!leavesInTime(crew.time + distance(crew.at, home.at) / planner.metersPerMinute, home)) return null;
  const path = planner.drive(crew.at, home.at);
  const leg = path ? legAlong(path, crew.time, planner.metersPerMinute) : null;
  return leg && leavesInTime(leg.endMinutes, home) ? leg : null;
}

// Down the list from the top: the first home nobody has taken that this crew can reach in time.
function nextVisit(crew: Crew, planner: Planner) {
  for (const home of queueAt(planner.queue, crew.time)) {
    if (planner.claimed.has(home.id)) continue;
    const leg = driveTo(crew, home, planner);
    if (leg) return { home, leg };
    crew.run.passed.push({ home: home.id, atMinutes: crew.time });
  }
  return null;
}

function goTo(crew: Crew, planner: Planner, home: CrewHome, leg: CrewLeg) {
  planner.claimed.add(home.id);
  crew.run.legs.push(leg);
  const leaveMinutes = leg.endMinutes + home.dwellMinutes;
  crew.run.visits.push({ home: home.id, at: home.at, sentMinutes: crew.time, arriveMinutes: leg.endMinutes, leaveMinutes, fireMinutes: home.fireMinutes });
  crew.at = home.at;
  crew.time = leaveMinutes;
}

// Nothing on the list it can take: back toward the station, until the list next changes.
function standBy(crew: Crew, planner: Planner) {
  const wake = nextChange(planner.queue, crew.time);
  const path = distance(crew.at, crew.run.at) > AT_STATION_METERS ? planner.drive(crew.at, crew.run.at) : null;
  if (path) {
    const whole = legAlong(path, crew.time, planner.metersPerMinute);
    const leg = wake < whole.endMinutes ? cutLeg(whole, wake) : whole;
    crew.run.legs.push(leg);
    crew.at = leg.path[leg.path.length - 1];
  }
  crew.done = wake === Infinity;
  crew.time = wake;
}

function step(crew: Crew, planner: Planner) {
  const next = nextVisit(crew, planner);
  if (next) goTo(crew, planner, next.home, next.leg);
  else standBy(crew, planner);
}

// The crew free soonest picks next. Crews free at the same minute go nearest the list's top home
// first, then in the order the stations are listed, so a night always plans the same.
function nextCrew(crews: Crew[], planner: Planner) {
  const free = crews.filter((crew) => !crew.done);
  if (free.length === 0) return null;
  const time = Math.min(...free.map((crew) => crew.time));
  const tied = free.filter((crew) => crew.time === time);
  const top = queueAt(planner.queue, time).find((home) => !planner.claimed.has(home.id));
  if (!top) return tied[0];
  return tied.reduce((nearest, crew) => (distance(crew.at, top.at) < distance(nearest.at, top.at) ? crew : nearest));
}

// `queue` is the door-check list over the night, snapshots in time order.
export function planCrews(starts: CrewStart[], queue: QueueSnapshot[], drive: DriveRoute, metersPerMinute = CREW_METERS_PER_MINUTE): CrewRun[] {
  const planner: Planner = { queue, claimed: new Set(), drive, metersPerMinute };
  const crews: Crew[] = starts.map((start) => ({ run: { ...start, legs: [], visits: [], passed: [] }, at: start.at, time: start.leavesAt, done: false }));
  for (let crew = nextCrew(crews, planner); crew; crew = nextCrew(crews, planner)) step(crew, planner);
  return crews.map((crew) => crew.run);
}

// ---- Playback ----

export type CrewMoment =
  | { kind: "idle"; at: Point; atStation: boolean }
  | { kind: "driving"; at: Point; leg: CrewLeg; ahead: Point[]; to: CrewVisit | null }
  | { kind: "helping"; at: Point; visit: CrewVisit; progress: number };

function driving(run: CrewRun, leg: CrewLeg, minutes: number): CrewMoment {
  const { at, index } = pointAlong(leg, leg.meters[leg.meters.length - 1] * shareAt(leg, minutes));
  const to = run.visits.find((visit) => visit.sentMinutes === leg.startMinutes) ?? null;
  return { kind: "driving", at, leg, ahead: [at, ...leg.path.slice(index)], to };
}

function lastStop(run: CrewRun, minutes: number): Point {
  let at = run.at;
  for (const leg of run.legs) if (leg.endMinutes <= minutes) at = leg.path[leg.path.length - 1];
  return at;
}

// Where a crew is at a minute after the warning, and what it is doing there.
export function crewAt(run: CrewRun, minutes: number): CrewMoment {
  const leg = run.legs.find((candidate) => candidate.startMinutes <= minutes && minutes < candidate.endMinutes);
  if (leg) return driving(run, leg, minutes);
  const visit = run.visits.find((candidate) => candidate.arriveMinutes <= minutes && minutes < candidate.leaveMinutes);
  if (visit) return { kind: "helping", at: visit.at, visit, progress: (minutes - visit.arriveMinutes) / (visit.leaveMinutes - visit.arriveMinutes) };
  const at = lastStop(run, minutes);
  return { kind: "idle", at, atStation: distance(at, run.at) <= AT_STATION_METERS };
}

// Every home the crews have left by a minute after the warning.
export function visitedBy(runs: CrewRun[], minutes: number) {
  return runs.flatMap((run) => run.visits.filter((visit) => visit.leaveMinutes <= minutes));
}

// Where each listed home stands with the crews at a minute: an engine on its way or at the door, the
// door knocked, or passed over because no crew in the plan can reach it in time.
export type DoorState = { kind: "sent" | "knocked"; engine: string } | { kind: "passed" };

export function doorStates(runs: CrewRun[], minutes: number) {
  const states = new Map<string, DoorState>();
  for (const run of runs) {
    for (const visit of run.visits) {
      if (visit.sentMinutes <= minutes) states.set(visit.home, { kind: visit.leaveMinutes <= minutes ? "knocked" : "sent", engine: run.engine });
    }
  }
  const takenLater = new Set(runs.flatMap((run) => run.visits.map((visit) => visit.home)));
  for (const run of runs) {
    for (const passed of run.passed) if (passed.atMinutes <= minutes && !takenLater.has(passed.home)) states.set(passed.home, { kind: "passed" });
  }
  return states;
}
