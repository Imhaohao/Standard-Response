import { QueryCtx } from "./_generated/server";
import { createProjection } from "../lib/ink-map/data";
import { arrivalAt, holds, NEVER_BURNS, ScenarioFront, scenarioFronts, WILDFIRE_LINE_HOLD } from "../lib/ink-map/fire-field";
import { DEFAULT_HAZARD, Hazard } from "./hazards";
import { callPriorityFor, FIRE_FIRST_ARRIVAL_MINUTES, FIRE_ORIGIN, FIRE_SPREAD_METERS_PER_MINUTE, metersBetween } from "./model";
import { SCENARIO_FRONTS } from "./scenarioFronts";
import { simTime } from "../lib/sim-clock";

// When the hazard reaches a home, measured against the same scenario fronts the maps draw
// (lib/ink-map/fire-field.ts does the arithmetic for both), so a rider's deadline and the fire the
// dispatcher sees agree. Track D's runner, when it runs, writes the same arrivals.

type Point = { lat: number; lng: number };

const projection = createProjection(FIRE_ORIGIN);

const FRONTS = new Map<Hazard, ScenarioFront[]>(
  Object.entries(SCENARIO_FRONTS).map(([hazard, geojson]) => [hazard as Hazard, scenarioFronts(geojson, projection.toLocal)]),
);

// A home the scenario never reaches still needs a deadline: just past the scenario's last front.
const PAST_SCENARIO_MINUTES = 30;

// Before a warning there is no clock to measure from; the warning replaces this for every home.
export const PLACEHOLDER_ARRIVAL_MINUTES = 90;

// A hazard with no scenario file keeps the old radial stand-in.
function radialMinutes(point: Point) {
  return FIRE_FIRST_ARRIVAL_MINUTES + metersBetween(point, FIRE_ORIGIN) / FIRE_SPREAD_METERS_PER_MINUTE;
}

// Crews holding a wildfire line stretch the uncontained scenario. Other hazards keep their own clock.
function held(minutes: number, hazard: Hazard) {
  return hazard === "wildfire" ? minutes * WILDFIRE_LINE_HOLD : minutes;
}

export function minutesUntilHazard(point: Point, hazard: Hazard) {
  const fronts = FRONTS.get(hazard);
  if (!fronts?.length) return held(radialMinutes(point), hazard);
  const [x, y] = projection.toLocal(point);
  const arrival = arrivalAt(fronts, x, y);
  const minutes = arrival >= NEVER_BURNS ? fronts[fronts.length - 1].minutes + PAST_SCENARIO_MINUTES : arrival;
  return held(minutes, hazard);
}

// False for a home the scenario's fire never reaches: its arrival is only a deadline past the last front.
export function hazardReaches(point: Point, hazard: Hazard) {
  const fronts = FRONTS.get(hazard);
  if (!fronts?.length) return true;
  const [x, y] = projection.toLocal(point);
  return arrivalAt(fronts, x, y) < NEVER_BURNS;
}

export type Compass = "north" | "northeast" | "east" | "southeast" | "south" | "southwest" | "west" | "northwest";
const COMPASS: Compass[] = ["east", "northeast", "north", "northwest", "west", "southwest", "south", "southeast"];
// meters 0 once the hazard holds the home; direction is where the nearest edge lies from the home.
export type HazardEdge = { meters: number; direction: Compass | null };

function nearestOnRing(ring: number[][], x: number, y: number) {
  let best = { meters: Infinity, dx: 0, dy: 0 };
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    const dx = ax + t * ex - x;
    const dy = ay + t * ey - y;
    const meters = Math.hypot(dx, dy);
    if (meters < best.meters) best = { meters, dx, dy };
  }
  return best;
}

const compassOf = (dx: number, dy: number) => COMPASS[Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) / 45) % 8];

// Where the hazard's edge stands from a home this many minutes after the warning, on the same
// scenario fronts the maps draw. Null before the first front, or for a hazard with no scenario file.
export function hazardEdgeFrom(point: Point, hazard: Hazard, minutesAfterWarning: number): HazardEdge | null {
  const fronts = FRONTS.get(hazard);
  const front = fronts?.filter((candidate) => candidate.minutes <= minutesAfterWarning).at(-1);
  if (!front) return null;
  const [x, y] = projection.toLocal(point);
  if (holds(front, x, y)) return { meters: 0, direction: null };
  const rings = (front.polygons ?? [[front.ring]]).flat();
  const nearest = rings.map((ring) => nearestOnRing(ring, x, y)).reduce((a, b) => (b.meters < a.meters ? b : a));
  return { meters: nearest.meters, direction: compassOf(nearest.dx, nearest.dy) };
}

export const fireArrivalFor = (point: Point, warningAt: number, hazard: Hazard) => warningAt + minutesUntilHazard(point, hazard) * 60_000;

// For a home added now: measured from the warning once it is out, a placeholder before it.
export async function fireArrivalForNewHome(ctx: QueryCtx, point: Partial<Point>) {
  const control = await ctx.db.query("control").first();
  const now = simTime(control?.clock, Date.now());
  const warningAt = control?.warningIssuedAt;
  if (warningAt === undefined || point.lat === undefined || point.lng === undefined) return now + PLACEHOLDER_ARRIVAL_MINUTES * 60_000;
  return fireArrivalFor({ lat: point.lat, lng: point.lng }, warningAt, control?.hazard ?? DEFAULT_HAZARD);
}

// A home's fire arrival and the call priority that follows from it, for a home added or moved now.
export async function timingForHome(ctx: QueryCtx, point: Partial<Point>, needProbability: number) {
  const fireArrivalAt = await fireArrivalForNewHome(ctx, point);
  const now = simTime((await ctx.db.query("control").first())?.clock, Date.now());
  return { fireArrivalAt, callPriority: callPriorityFor(needProbability, fireArrivalAt, now) };
}
