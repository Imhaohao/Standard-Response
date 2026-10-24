import { DIMENSIONS, GlobalModel, Mix } from "./federated";

// The government's side of federated averaging. Uploads are mixes: sums of private updates and
// the number of phones' worth of mass in them. A round collects mass for the current model; once
// it holds ROUND_MASS the model takes one step of the averaged update (DP-FedAvg, McMahan et al.
// 2018, with the noise added on the phones instead of the server). The step is FedAdam (Reddi et
// al. 2021): per-coordinate step sizes, because the fire terms are nonzero for only a few percent
// of streets and plain steps barely move them, and first-moment averaging, which also averages the
// phones' noise over recent rounds at no cost to privacy. FedAvgM (server momentum) is the other
// option. A mix built on the previous model still counts at half weight; older ones are refused,
// because early-night updates (nearly every street still open) would keep pulling a model that
// has already moved past them.

export const ROUND_MASS = 40;
export type ServerOptimizer =
  | { kind: "momentum"; learningRate: number; momentum: number }
  | { kind: "adam"; learningRate: number; beta1: number; beta2: number; tau: number };
export const DEFAULT_OPTIMIZER: ServerOptimizer = { kind: "adam", learningRate: 0.3, beta1: 0.9, beta2: 0.99, tau: 1e-3 };

// Kept on the server and never sent to phones.
export type OptimizerState = { first: number[]; second: number[] };
export const freshOptimizerState = (): OptimizerState => ({ first: Array(DIMENSIONS).fill(0), second: Array(DIMENSIONS).fill(0) });
export type OpenRound = { baseVersion: number; sum: number[]; mass: number; uploads: number; staleMass: number };

export const emptyRound = (baseVersion: number): OpenRound => ({
  baseVersion,
  sum: Array(DIMENSIONS).fill(0),
  mass: 0,
  uploads: 0,
  staleMass: 0,
});

export const MAX_STALENESS = 1;
export const stalenessWeight = (behind: number) => 1 / (1 + Math.max(0, behind));

// Adds one upload to the open round. A mix for a version that doesn't exist yet, or one more than
// MAX_STALENESS versions old, is refused.
export function addToRound(round: OpenRound, mix: Mix): OpenRound | null {
  const behind = round.baseVersion - mix.version;
  if (behind < 0 || behind > MAX_STALENESS) return null;
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

function serverStep(step: number[], state: OptimizerState, optimizer: ServerOptimizer) {
  if (optimizer.kind === "momentum") {
    const first = step.map((value, i) => optimizer.momentum * state.first[i] + value);
    return { change: first.map((value) => optimizer.learningRate * value), state: { first, second: state.second } };
  }
  const first = step.map((value, i) => optimizer.beta1 * state.first[i] + (1 - optimizer.beta1) * value);
  const second = step.map((value, i) => optimizer.beta2 * state.second[i] + (1 - optimizer.beta2) * value * value);
  const change = first.map((value, i) => (optimizer.learningRate * value) / (Math.sqrt(second[i]) + optimizer.tau));
  return { change, state: { first, second } };
}

// One server step from the round's averaged update.
export function closeRound(
  model: GlobalModel,
  round: OpenRound,
  issuedAt: number,
  state: OptimizerState = freshOptimizerState(),
  optimizer: ServerOptimizer = DEFAULT_OPTIMIZER,
) {
  const step = round.sum.map((value) => value / round.mass);
  const { change, state: next } = serverStep(step, state, optimizer);
  const updated: GlobalModel = {
    version: model.version + 1,
    weights: model.weights.map((value, i) => value + change[i]),
    issuedAt,
    contributors: model.contributors + round.mass,
  };
  return { model: updated, state: next };
}
