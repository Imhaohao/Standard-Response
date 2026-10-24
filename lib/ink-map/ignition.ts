import type { Point } from "./data";
import { buildFireField, ScenarioFront } from "./fire-field";
import type { Hazard } from "./hazard";

// A rehearsal fire lit at one house. Each front is an ellipse stretched downwind, the shape a
// wind-driven fire takes: the head runs fastest, the flanks slower, the back slowest.
const HEAD_METERS_PER_MINUTE = 18;
const FLANK_METERS_PER_MINUTE = 6;
const BACK_METERS_PER_MINUTE = 2;
const HOUSE_RADIUS_METERS = 15;
const FRONT_EVERY_MINUTES = 30;
const LAST_FRONT_MINUTES = 240;
const RING_POINTS = 48;
// Santa Ana winds blow from the northeast, so with no scenario to read the wind from, the fire runs southwest.
const SOUTHWEST: Point = [-Math.SQRT1_2, -Math.SQRT1_2];

function centroid(ring: Point[]): Point {
  const sum = ring.reduce<Point>((total, [x, y]) => [total[0] + x, total[1] + y], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}

// The way the loaded scenario's fire travels overall, from its first front's middle to its last's.
export function downwindOf(fronts: ScenarioFront[] | undefined): Point {
  if (!fronts || fronts.length < 2) return SOUTHWEST;
  const [x0, y0] = centroid(fronts[0].ring);
  const [x1, y1] = centroid(fronts[fronts.length - 1].ring);
  const length = Math.hypot(x1 - x0, y1 - y0);
  return length < 1 ? SOUTHWEST : [(x1 - x0) / length, (y1 - y0) / length];
}

function frontAt(ignition: Point, wind: Point, minutes: number): ScenarioFront {
  const along = ((HEAD_METERS_PER_MINUTE + BACK_METERS_PER_MINUTE) / 2) * minutes + HOUSE_RADIUS_METERS;
  const across = FLANK_METERS_PER_MINUTE * minutes + HOUSE_RADIUS_METERS;
  const shift = ((HEAD_METERS_PER_MINUTE - BACK_METERS_PER_MINUTE) / 2) * minutes;
  const center: Point = [ignition[0] + wind[0] * shift, ignition[1] + wind[1] * shift];
  const side: Point = [-wind[1], wind[0]];
  const ring = Array.from({ length: RING_POINTS }, (_, i): Point => {
    const angle = (i / RING_POINTS) * 2 * Math.PI;
    const a = Math.cos(angle) * along;
    const b = Math.sin(angle) * across;
    return [center[0] + wind[0] * a + side[0] * b, center[1] + wind[1] * a + side[1] * b];
  });
  return { minutes, ring };
}

export function ignitionHazard(ignition: Point, wind: Point): Hazard {
  const fronts: ScenarioFront[] = [];
  for (let minutes = 0; minutes <= LAST_FRONT_MINUTES; minutes += FRONT_EVERY_MINUTES) fronts.push(frontAt(ignition, wind, minutes));
  return {
    field: buildFireField(fronts),
    label: "Simulated fire, not a forecast",
    basis: `Lit at one house: ${HEAD_METERS_PER_MINUTE} m/min downwind, ${FLANK_METERS_PER_MINUTE} m/min on the flanks`,
  };
}
