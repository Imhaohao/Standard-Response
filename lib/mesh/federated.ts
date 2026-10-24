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
// two phones meet, each sends the other half of what it holds, so mass is conserved and the
// ratio sum/mass stays the average of everything mixed in (push-sum gossip, Kempe et al. 2003).
// A phone with internet uploads what it holds once its mass reaches UPLOAD_MIN_MASS and resets to
// zero. The government ends up with sums over many phones' worth of mass and never one update.

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

export function featuresOf(input: FeatureInput): number[] {
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
  epochs: number;
  learningRate: number;
  l2: number;
  clip: number;
  noiseMultiplier: number;
};

export const DEFAULT_TRAINING: TrainingParams = { epochs: 5, learningRate: 0.3, l2: 1e-3, clip: 1, noiseMultiplier: 1.5 };

// Minimum examples before a phone takes part, so a one-observation phone doesn't add pure noise.
export const MIN_EXAMPLES = 4;

function shuffled<T>(items: T[], random: Random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Plain SGD on the logistic loss from the global weights; returns the new weights.
export function trainLocally(weights: readonly number[], examples: Example[], params: TrainingParams, random: Random) {
  const w = [...weights];
  for (let epoch = 0; epoch < params.epochs; epoch++) {
    for (const { x, y } of shuffled(examples, random)) {
      const error = predict(w, x) - y;
      for (let i = 0; i < w.length; i++) w[i] -= params.learningRate * (error * x[i] + params.l2 * w[i]);
    }
  }
  return w;
}

// What leaves the phone: the change to the weights, clipped and noised on the phone.
export function privateUpdate(model: GlobalModel, examples: Example[], params: TrainingParams, random: Random) {
  const trained = trainLocally(model.weights, examples, params, random);
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
const KEEP_VERSIONS = 3;

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

  // Keeps half of every version and returns the other half, each with a fresh transfer id.
  splitHalf(newId: IdSource): { transfer: string; mix: Mix }[] {
    const out: { transfer: string; mix: Mix }[] = [];
    for (const state of this.states.values()) {
      if (state.mass <= 1e-9) continue;
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

  // Old versions are still worth uploading (the server discounts staleness), but only a few are kept.
  prune(currentVersion: number) {
    for (const version of this.states.keys()) if (version < currentVersion - KEEP_VERSIONS) this.states.delete(version);
  }
}
