import { DEADLINE_MARGIN_MINUTES } from "./model";

// Assumed fatality-risk model, mirrored from dispatch/fatality.py (the solver's objective); change
// both together. An assumption, not a prediction: risk grows with need weight, is zero when the
// rider boards by the deadline, and rises linearly to its cap at fire arrival. Shown only as totals.

const DEATH_SHARE_PER_WEIGHT = 0.2;
const MAX_DEATH_SHARE = 0.9;
const RAMP_MS = DEADLINE_MARGIN_MINUTES * 60_000;

type RiskFields = {
  weight: number;
  load: { seats: number; wheelchairSpaces: number; stretcherSpaces: number };
};

export function deathsIfUnserved({ weight, load }: RiskFields) {
  const people = load.seats + load.wheelchairSpaces + load.stretcherSpaces;
  return people * Math.min(MAX_DEATH_SHARE, DEATH_SHARE_PER_WEIGHT * weight);
}

// boardsAt is when the rider is expected to have finished boarding; null means nobody is coming.
export function expectedDeaths(rider: RiskFields & { deadlineAt: number }, boardsAt: number | null) {
  const worst = deathsIfUnserved(rider);
  if (boardsAt === null) return worst;
  return worst * Math.min(1, Math.max(0, (boardsAt - rider.deadlineAt) / RAMP_MS));
}
