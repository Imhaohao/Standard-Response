import { QueryCtx } from "./_generated/server";
import { createProjection } from "../lib/ink-map/data";
import { arrivalAt, NEVER_BURNS, ScenarioFront, scenarioFronts } from "../lib/ink-map/fire-field";
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

export function minutesUntilHazard(point: Point, hazard: Hazard) {
  const fronts = FRONTS.get(hazard);
  if (!fronts?.length) return radialMinutes(point);
  const [x, y] = projection.toLocal(point);
  const arrival = arrivalAt(fronts, x, y);
  return arrival >= NEVER_BURNS ? fronts[fronts.length - 1].minutes + PAST_SCENARIO_MINUTES : arrival;
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
