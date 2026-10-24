import { l2Norm, privatize } from "./privacy";
import { IdSource, Random } from "./random";

// Federated learning over the phone mesh.
//
// The model is a logistic regression that estimates how likely a street segment is to be blocked
// from things a phone can know offline: how close the fire scenario in the warning puts the fire,
// the kind of road, how long since the warning, and how many nearby segments this phone already
// knows are blocked. Phones train on what they themselves saw. Raw observations never leave the
// phone; only a clipped, noised change to the weights does.
//
// Aggregation happens between phones. Each contribution is a (sum, mass) pair with mass 1. When
// two phones meet, the one holding less of a version sends the other half of it, so mass is
// conserved, the ratio sum/mass stays the average of everything mixed in (push-sum gossip, Kempe
// et al. 2003), and mass gathers on a few phones instead of spreading thin. A gateway (a phone
// with internet whose owner agreed to upload for others) counts as heaviest, so mass flows to it.
// A gateway uploads what it holds once its mass reaches UPLOAD_MIN_MASS and resets to zero. The
// government ends up with sums over many phones' worth of mass and never one update.

export const FEATURE_NAMES = [
  "bias",
  "fire_within_30_min",
  "fire_arrived",
  "minor_road",
  "lanes",
  "hours_since_warning",
  "nearby_blocked_share",
] as const;
export const DIMENSIONS = FEATURE_NAMES.length;

export type FeatureInput = {
  minutesToFire: number;
  kph: number;
  lanes: number;
  minutesSinceWarning: number;
  nearbyBlockedShare: number;
};

// The features before standardisation.
export function rawFeaturesOf(input: FeatureInput): number[] {
  const toFire = Math.max(-240, Math.min(input.minutesToFire, 600));
  return [
    1,
    Math.exp(-Math.max(toFire, 0) / 30),
    toFire <= 0 ? 1 : 0,
    input.kph < 45 ? 1 : 0,
    Math.min(Math.max(input.lanes, 1), 6) / 4,
    Math.min(Math.max(input.minutesSinceWarning, 0), 480) / 180,
    Math.min(Math.max(input.nearbyBlockedShare, 0), 1),
  ];
}

// Every feature but the bias is centred and scaled by its mean and spread over every street in the
// map from the warning to five hours after it (scripts/mesh/feature-scale.ts recomputes them from
// the road graph and the fire scenario, both public). Scaling on the phone, before clipping and
// noise, matters: noise is the same size in every direction of the weights, so a feature that is
// rarely nonzero would otherwise carry a signal far below the noise. Centring also separates the
// bias from road class and the clock, which plain gradient steps otherwise confuse.
export const FEATURE_CENTER = [0, 0.179, 0.149, 0.553, 0.433, 0.833, 0.144];
export const FEATURE_SCALE = [1, 0.363, 0.356, 0.497, 0.299, 0.505, 0.271];

export function featuresOf(input: FeatureInput): number[] {
  return rawFeaturesOf(input).map((value, i) => (i === 0 ? 1 : (value - FEATURE_CENTER[i]) / FEATURE_SCALE[i]));
}

export type GlobalModel = { version: number; weights: number[]; issuedAt: number; contributors: number };
export const INITIAL_MODEL: GlobalModel = { version: 0, weights: Array(DIMENSIONS).fill(0), issuedAt: 0, contributors: 0 };

export type Example = { x: number[]; y: 0 | 1 };

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, z))));

export function dot(a: readonly number[], b: readonly number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export const predict = (weights: readonly number[], x: readonly number[]) => sigmoid(dot(weights, x));

export type TrainingParams = {
  // A phone contributes to at most this many model versions, which bounds its total privacy loss.
  maxContributions: number;
  epochs: number;
  learningRate: number;
  l2: number;
  positiveWeight: number;
  clip: number;
  noiseMultiplier: number;
};

export const DEFAULT_TRAINING: TrainingParams = {
  maxContributions: 6,
  epochs: 3,
  learningRate: 0.5,
  l2: 1e-3,
  positiveWeight: 10,
  clip: 0.5,
  noiseMultiplier: 1.5,
};

// Minimum examples before a phone takes part, so a one-observation phone doesn't add pure noise.
export const MIN_EXAMPLES = 4;

// Gradient of the weighted mean logistic loss. Blocked roads are a few percent of what phones
// see, so each blocked observation counts `positiveWeight` times. For a logistic model that mostly
// moves the intercept, so the ranking of streets (what the agency uses) is unchanged, while the
// fire terms get enough signal to rise above the privacy noise.
export function meanGradient(weights: readonly number[], examples: Example[], l2: number, positiveWeight = 1) {
  const gradient = Array(weights.length).fill(0);
  let total = 0;
  for (const { x, y } of examples) {
    const weight = y === 1 ? positiveWeight : 1;
    const error = (predict(weights, x) - y) * weight;
    for (let i = 0; i < gradient.length; i++) gradient[i] += error * x[i];
    total += weight;
  }
  return gradient.map((g, i) => g / Math.max(total, 1) + l2 * weights[i]);
}

// A few full-batch gradient steps from the global weights. Full-batch steps keep an update's size
// tied to how badly the model fits this phone's data, so phones that only ever saw clear roads
// stop pushing once the model agrees with them, instead of pulling it toward "nothing is ever
// blocked" (client drift under label skew, which per-example SGD with clipping makes worse).
export function trainLocally(
  weights: readonly number[],
  examples: Example[],
  params: Pick<TrainingParams, "epochs" | "learningRate" | "l2" | "positiveWeight">,
) {
  let w = [...weights];
  for (let epoch = 0; epoch < params.epochs; epoch++) {
    const gradient = meanGradient(w, examples, params.l2, params.positiveWeight);
    w = w.map((value, i) => value - params.learningRate * gradient[i]);
  }
  return w;
}

function solve(matrix: number[][], vector: number[]) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < n; row++) {
      if (row === col || a[col][col] === 0) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row, i) => (row[i] === 0 ? 0 : row[n] / row[i]));
}

// Logistic regression fitted centrally by Newton's method. Only for measuring: it needs every
// example in one place, which is exactly what the phones never allow.
// The dimension is the examples' (the street-blockage model's when there are none).
export function fitCentrally(examples: Example[], l2 = 1e-3, iterations = 12) {
  const dimensions: number = examples[0]?.x.length ?? DIMENSIONS;
  let w: number[] = Array(dimensions).fill(0);
  for (let it = 0; it < iterations && examples.length > 0; it++) {
    const gradient = meanGradient(w, examples, l2);
    const hessian = Array.from({ length: dimensions }, (_, i) => Array.from({ length: dimensions }, (_, j) => (i === j ? l2 : 0)));
    for (const { x } of examples) {
      const p = predict(w, x);
      const weight = (p * (1 - p)) / examples.length;
      for (let i = 0; i < dimensions; i++) for (let j = 0; j < dimensions; j++) hessian[i][j] += weight * x[i] * x[j];
    }
    const step = solve(hessian, gradient);
    w = w.map((value, i) => value - step[i]);
  }
  return w;
}

// What leaves the phone: the change to the weights, clipped and noised on the phone.
export function privateUpdate(model: GlobalModel, examples: Example[], params: TrainingParams, random: Random) {
  const trained = trainLocally(model.weights, examples, params);
  const delta = trained.map((value, i) => value - model.weights[i]);
  return privatize(delta, params.clip, params.noiseMultiplier, random);
}

export function logLoss(weights: readonly number[], examples: Example[]) {
  if (examples.length === 0) return 0;
  let total = 0;
  for (const { x, y } of examples) {
    const p = Math.min(Math.max(predict(weights, x), 1e-9), 1 - 1e-9);
    total -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  return total / examples.length;
}

// Area under the ROC curve by ranking (ties share ranks).
export function auc(weights: readonly number[], examples: Example[]) {
  const scored = examples.map(({ x, y }) => ({ score: dot(weights, x), y })).sort((a, b) => a.score - b.score);
  const positives = scored.filter((s) => s.y === 1).length;
  const negatives = scored.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;
  let rankSum = 0;
  for (let i = 0; i < scored.length; ) {
    let j = i;
    while (j < scored.length && scored[j].score === scored[i].score) j++;
    const rank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (scored[k].y === 1) rankSum += rank;
    i = j;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export type Mix = { version: number; sum: number[]; mass: number };

export const UPLOAD_MIN_MASS = 5;
const MAX_MASS = 1e6;
// A clipped update has norm <= clip; noise adds about noiseMultiplier * clip * sqrt(d) per
// contribution. Anything far outside that is not an honest mix and is refused.
export function maxMixNorm(params: Pick<TrainingParams, "clip" | "noiseMultiplier">) {
  return params.clip * (1 + 6 * params.noiseMultiplier * Math.sqrt(DIMENSIONS));
}

export function isValidMix(value: unknown, params: Pick<TrainingParams, "clip" | "noiseMultiplier"> = DEFAULT_TRAINING): value is Mix {
  if (typeof value !== "object" || value === null) return false;
  const mix = value as Record<string, unknown>;
  if (typeof mix.version !== "number" || !Number.isInteger(mix.version) || mix.version < 0) return false;
  if (typeof mix.mass !== "number" || !(mix.mass > 0) || mix.mass > MAX_MASS) return false;
  if (!Array.isArray(mix.sum) || mix.sum.length !== DIMENSIONS) return false;
  if (!mix.sum.every((x) => typeof x === "number" && Number.isFinite(x))) return false;
  return l2Norm(mix.sum as number[]) / mix.mass <= maxMixNorm(params) * Math.max(1, 1 / Math.sqrt(mix.mass));
}

export function isValidModel(value: unknown): value is GlobalModel {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Record<string, unknown>;
  return (
    typeof model.version === "number" &&
    Number.isInteger(model.version) &&
    model.version >= 0 &&
    Array.isArray(model.weights) &&
    model.weights.length === DIMENSIONS &&
    model.weights.every((x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e3) &&
    typeof model.issuedAt === "number" &&
    typeof model.contributors === "number"
  );
}

const RECENT_TRANSFERS = 512;

// What one phone holds for each model version, plus the transfers it has already applied.
export class MixPool {
  private states = new Map<number, Mix>();
  private applied: string[] = [];

  constructor(initial: Mix[] = []) {
    for (const mix of initial) this.absorb(mix);
  }

  versions() {
    return [...this.states.keys()].sort((a, b) => a - b);
  }

  get(version: number): Mix | undefined {
    return this.states.get(version);
  }

  totalMass() {
    let mass = 0;
    for (const mix of this.states.values()) mass += mix.mass;
    return mass;
  }

  all(): Mix[] {
    return [...this.states.values()].map((mix) => ({ ...mix, sum: [...mix.sum] }));
  }

  contribute(version: number, update: number[]) {
    this.absorb({ version, sum: update, mass: 1 });
  }

  absorb(mix: Mix, transfer?: string) {
    if (transfer !== undefined) {
      if (this.applied.includes(transfer)) return false;
      this.applied.push(transfer);
      if (this.applied.length > RECENT_TRANSFERS) this.applied.shift();
    }
    const current = this.states.get(mix.version);
    if (!current) this.states.set(mix.version, { version: mix.version, sum: [...mix.sum], mass: mix.mass });
    else {
      for (let i = 0; i < current.sum.length; i++) current.sum[i] += mix.sum[i];
      current.mass += mix.mass;
    }
    return true;
  }

  holding(): { version: number; mass: number }[] {
    return [...this.states.values()].map(({ version, mass }) => ({ version, mass }));
  }

  // Keeps half of each chosen version and returns the other half, each with a fresh transfer id.
  splitHalf(newId: IdSource, give: (version: number, mass: number) => boolean = () => true): { transfer: string; mix: Mix }[] {
    const out: { transfer: string; mix: Mix }[] = [];
    for (const state of this.states.values()) {
      if (state.mass <= 1e-9 || !give(state.version, state.mass)) continue;
      for (let i = 0; i < state.sum.length; i++) state.sum[i] /= 2;
      state.mass /= 2;
      out.push({ transfer: newId(), mix: { version: state.version, sum: [...state.sum], mass: state.mass } });
    }
    return out;
  }

  // Removes and returns every version whose mass is large enough to upload without exposing anyone.
  drain(minMass = UPLOAD_MIN_MASS): Mix[] {
    const ready = [...this.states.values()].filter((mix) => mix.mass >= minMass);
    for (const mix of ready) this.states.delete(mix.version);
    return ready;
  }

  // Mass for versions the server would refuse as too stale is dropped (see rounds.ts).
  prune(currentVersion: number, maxStaleness: number) {
    for (const version of this.states.keys()) if (version < currentVersion - maxStaleness) this.states.delete(version);
  }
}
