import { gaussian, Random } from "../mesh/random";

// When a household leaves: a drift-diffusion decision, dX = mu(t) dt + sigma dW, leaving when X
// first reaches 1. Two classes, evacuation-keen and evacuation-reluctant, as in UC Berkeley's
// survey of California wildfire evacuees. The drift rises as the fire scenario gets close, which
// stands in for seeing smoke or hearing from neighbours. Every number here is a stated assumption.

export type DepartureParams = {
  keenShare: number;
  // Base drift per minute: a keen household leaves about 1/mu minutes after the warning.
  keenDrift: number;
  reluctantDrift: number;
  // Extra drift per minute when the fire is at the door, fading with a 30-minute scale.
  threatDrift: number;
  // Diffusion per square-root minute.
  sigma: number;
};

export const DEFAULT_DEPARTURE: DepartureParams = {
  keenShare: 0.55,
  keenDrift: 1 / 25,
  reluctantDrift: 1 / 110,
  threatDrift: 1 / 12,
  sigma: 0.12,
};

const THREAT_SCALE_MINUTES = 30;

export function departureDrift(keen: boolean, minutesToFire: number, params: DepartureParams) {
  const base = keen ? params.keenDrift : params.reluctantDrift;
  return base + params.threatDrift * Math.exp(-Math.max(0, minutesToFire) / THREAT_SCALE_MINUTES);
}

// One Euler-Maruyama step of the decision variable over `minutes`, and 1 if it reached 1 within the
// step. Between two steps below 1 the path may have crossed 1 and come back; given both ends, it did
// with probability exp(-2 (1 - x0)(1 - x1) / (sigma^2 minutes)), the Brownian bridge's (whatever
// the drift). Checking the steps alone left households leaving late: 1.5 minutes for a keen one at
// half-minute steps, 6 minutes for a reluctant one.
export function stepDecision(x: number, keen: boolean, minutesToFire: number, minutes: number, params: DepartureParams, random: Random) {
  const next = x + departureDrift(keen, minutesToFire, params) * minutes + params.sigma * Math.sqrt(minutes) * gaussian(random);
  if (x >= 1 || next >= 1) return next;
  const crossed = Math.exp((-2 * (1 - x) * (1 - next)) / (params.sigma * params.sigma * minutes));
  return random() < crossed ? 1 : next;
}
