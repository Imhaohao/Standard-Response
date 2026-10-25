import type { Point } from "./data";

// The wind over a rehearsal fire: a seeded random walk around a mean direction, so the same fire lit at
// the same house shifts and gusts the same way every time. The heading wanders back toward the mean,
// and now and then jumps by a few tens of degrees, the way a gust front swings a Santa Ana. Strength 1 is
// the mean wind; a gust doubles it at most. Mirrors modeling/rollcall_d/urban_spread.py's walk.

export const WIND_STEP_MINUTES = 5;
const HEADING_PULL = 0.2;
const HEADING_JITTER_DEGREES = 11;
const SHIFT_CHANCE = 0.1;
const SHIFT_DEGREES: [number, number] = [25, 45];
const STRENGTH_PULL = 0.25;
const STRENGTH_JITTER = 0.15;
const STRENGTH_RANGE: [number, number] = [0.3, 2];

export type Wind = { direction: Point; strength: number };

// A small deterministic generator (mulberry32): the same seed gives the same draws.
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(random: () => number) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

const clamp = (value: number, [low, high]: [number, number]) => Math.min(high, Math.max(low, value));

function rotate([x, y]: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return [x * Math.cos(radians) + y * Math.sin(radians), -x * Math.sin(radians) + y * Math.cos(radians)];
}

// The wind every WIND_STEP_MINUTES from minute 0 to `minutes`, blowing toward `mean` on average.
export function windWalk(mean: Point, seed: number, minutes: number): (minute: number) => Wind {
  const random = seededRandom(seed);
  const steps: Wind[] = [];
  let deviation = 0;
  let strength = 1;
  for (let step = 0; step * WIND_STEP_MINUTES <= minutes + WIND_STEP_MINUTES; step++) {
    deviation += -HEADING_PULL * deviation + gauss(random) * HEADING_JITTER_DEGREES;
    if (random() < SHIFT_CHANCE) deviation += (random() < 0.5 ? -1 : 1) * (SHIFT_DEGREES[0] + random() * (SHIFT_DEGREES[1] - SHIFT_DEGREES[0]));
    strength = clamp(strength + STRENGTH_PULL * (1 - strength) + gauss(random) * STRENGTH_JITTER, STRENGTH_RANGE);
    steps.push({ direction: rotate(mean, deviation), strength });
  }
  return (minute) => steps[clamp(Math.floor(minute / WIND_STEP_MINUTES), [0, steps.length - 1])];
}
