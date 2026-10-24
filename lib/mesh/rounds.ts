import { DIMENSIONS, GlobalModel, Mix } from "./federated";

// The government's side of federated averaging. Uploads are mixes: sums of private updates and
// the number of phones' worth of mass in them. A round collects mass for the current model; once
// it holds ROUND_MASS the model takes one step of the averaged update (DP-FedAvg, McMahan et al.
// 2018, with the noise added on the phones instead of the server). A mix built on an older model
// still counts, discounted by how many versions behind it is.

export const ROUND_MASS = 20;
export const SERVER_LEARNING_RATE = 1;

export type OpenRound = { baseVersion: number; sum: number[]; mass: number; uploads: number; staleMass: number };

export const emptyRound = (baseVersion: number): OpenRound => ({
  baseVersion,
  sum: Array(DIMENSIONS).fill(0),
  mass: 0,
  uploads: 0,
  staleMass: 0,
});

export const stalenessWeight = (behind: number) => 1 / (1 + Math.max(0, behind));

// Adds one upload to the open round. A mix for a version that doesn't exist yet is refused.
export function addToRound(round: OpenRound, mix: Mix): OpenRound | null {
  const behind = round.baseVersion - mix.version;
  if (behind < 0) return null;
  const weight = stalenessWeight(behind);
  return {
    baseVersion: round.baseVersion,
    sum: round.sum.map((value, i) => value + weight * mix.sum[i]),
    mass: round.mass + weight * mix.mass,
    uploads: round.uploads + 1,
    staleMass: round.staleMass + (behind > 0 ? mix.mass : 0),
  };
}

export const roundIsReady = (round: OpenRound, roundMass = ROUND_MASS) => round.mass >= roundMass;

export function closeRound(model: GlobalModel, round: OpenRound, issuedAt: number, learningRate = SERVER_LEARNING_RATE): GlobalModel {
  const step = round.sum.map((value) => value / round.mass);
  return {
    version: model.version + 1,
    weights: model.weights.map((value, i) => value + learningRate * step[i]),
    issuedAt,
    contributors: model.contributors + round.mass,
  };
}
