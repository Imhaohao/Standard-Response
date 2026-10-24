import { l2Norm } from "../mesh/privacy";
import { IdSource } from "../mesh/random";
import { isPlausibleTally, TALLY_DIMENSIONS } from "./tally";
import { SURVEY_TRAINING, TASK_IDS, TaskId, taskDimensions } from "./tasks";

// Push-sum mixing (Kempe et al. 2003) of everything households send, as in lib/mesh/federated.ts:
// each contribution is a (sum, mass) pair of mass 1, a phone meeting a heavier one hands it half of
// what it holds, mass is conserved and gathers on gateways, and the county accepts only mixes of at
// least UPLOAD_MIN_MASS contributions.
//
// Everything a household sends goes into one vector per survey campaign, so it mixes as one
// channel: its counts (tally.ts), and for each model an update block of the update, the version it
// was trained on, and a 1 saying an update is there. One channel keeps mixes dense. Model updates
// alone are sparse, because the county asks only about COHORT households per version (tasks.ts);
// in a channel of their own a gateway would hold one or two households' worth and never reach the
// floor. Mixed in with everyone's counts, an update is always hidden among five or more
// contributions, and the county reads each block's own mass and average version back out. Updates
// trained on different versions mix together, and the county discounts a block by how far its
// average version is behind (asynchronous buffered aggregation, as in FedBuff, Nguyen et al. 2022).

export const CAMPAIGN = "2026";
export const SURVEY_CHANNEL = `survey:${CAMPAIGN}`;
export const UPLOAD_MIN_MASS = 5;
const MAX_MASS = 1e6;
const MAX_VERSION = 1e6;
const MAX_CHANNELS = 4;
const RECENT_TRANSFERS = 512;

export type Mix = { channel: string; sum: number[]; mass: number };

// Where each model's block starts: its update, then version × taken part, then taken part.
export const TASK_OFFSETS = (() => {
  const offsets = {} as Record<TaskId, number>;
  let offset = TALLY_DIMENSIONS;
  for (const task of TASK_IDS) {
    offsets[task] = offset;
    offset += taskDimensions(task) + 2;
  }
  return offsets;
})();
const LAST_TASK = TASK_IDS[TASK_IDS.length - 1];
export const VECTOR_LENGTH = TASK_OFFSETS[LAST_TASK] + taskDimensions(LAST_TASK) + 2;

export function countsVector(counts: number[]) {
  return [...counts, ...Array(VECTOR_LENGTH - TALLY_DIMENSIONS).fill(0)];
}

export function updateVector(task: TaskId, update: number[], version: number) {
  const vector = Array(VECTOR_LENGTH).fill(0);
  const offset = TASK_OFFSETS[task];
  update.forEach((value, i) => (vector[offset + i] = value));
  vector[offset + update.length] = version;
  vector[offset + update.length + 1] = 1;
  return vector;
}

export type UpdateBlock = { sum: number[]; version: number; mass: number };

// A summed vector read back: the counts, and per model the summed updates, how many households'
// worth are in them and their average version.
export function readMix(sum: readonly number[]) {
  const updates = {} as Record<TaskId, UpdateBlock>;
  for (const task of TASK_IDS) {
    const offset = TASK_OFFSETS[task];
    const d = taskDimensions(task);
    const mass = sum[offset + d + 1];
    updates[task] = { sum: sum.slice(offset, offset + d), version: mass > 1e-12 ? sum[offset + d] / mass : 0, mass };
  }
  return { counts: sum.slice(0, TALLY_DIMENSIONS), updates };
}

// A clipped update has norm <= clip and noise adds about noiseMultiplier * clip * sqrt(d) per
// household; anything far outside that is not an honest mix.
function plausibleBlock(block: UpdateBlock, mass: number, dimensions: number) {
  if (block.mass < -1e-9 || block.mass > mass + 1e-6) return false;
  if (block.mass <= 1e-12) return l2Norm(block.sum) < 1e-6;
  if (block.version < -1e-6 || block.version > MAX_VERSION) return false;
  const { clip, noiseMultiplier } = SURVEY_TRAINING;
  const bound = clip * (1 + 6 * noiseMultiplier * Math.sqrt(dimensions));
  return l2Norm(block.sum) / block.mass <= bound * Math.max(1, 1 / Math.sqrt(block.mass));
}

export function isValidMix(value: unknown): value is Mix {
  if (typeof value !== "object" || value === null) return false;
  const mix = value as Record<string, unknown>;
  if (mix.channel !== SURVEY_CHANNEL) return false;
  if (typeof mix.mass !== "number" || !(mix.mass > 0) || mix.mass > MAX_MASS) return false;
  if (!Array.isArray(mix.sum) || mix.sum.length !== VECTOR_LENGTH || !mix.sum.every((x) => typeof x === "number" && Number.isFinite(x))) return false;
  const mass = mix.mass;
  const { counts, updates } = readMix(mix.sum as number[]);
  return isPlausibleTally(counts, mass) && TASK_IDS.every((task) => plausibleBlock(updates[task], mass, taskDimensions(task)));
}

// What one phone holds per channel, plus the transfers it has already applied. There is one
// channel per survey campaign.
export class ChannelPool {
  private states = new Map<string, Mix>();
  private applied: string[] = [];

  get(channel: string): Mix | undefined {
    return this.states.get(channel);
  }

  totalMass() {
    let mass = 0;
    for (const mix of this.states.values()) mass += mix.mass;
    return mass;
  }

  all(): Mix[] {
    return [...this.states.values()].map((mix) => ({ ...mix, sum: [...mix.sum] }));
  }

  holding(): { channel: string; mass: number }[] {
    return [...this.states.values()].map(({ channel, mass }) => ({ channel, mass }));
  }

  contribute(channel: string, vector: number[]) {
    this.absorb({ channel, sum: vector, mass: 1 });
  }

  absorb(mix: Mix, transfer?: string) {
    if (transfer !== undefined) {
      if (this.applied.includes(transfer)) return false;
      this.applied.push(transfer);
      if (this.applied.length > RECENT_TRANSFERS) this.applied.shift();
    }
    const current = this.states.get(mix.channel);
    if (!current) {
      if (this.states.size >= MAX_CHANNELS) return false;
      this.states.set(mix.channel, { channel: mix.channel, sum: [...mix.sum], mass: mix.mass });
    } else {
      for (let i = 0; i < current.sum.length; i++) current.sum[i] += mix.sum[i];
      current.mass += mix.mass;
    }
    return true;
  }

  // Keeps half of every channel and returns the other half, each with a fresh transfer id.
  splitHalf(newId: IdSource): { transfer: string; mix: Mix }[] {
    const out: { transfer: string; mix: Mix }[] = [];
    for (const state of this.states.values()) {
      if (state.mass <= 1e-9) continue;
      for (let i = 0; i < state.sum.length; i++) state.sum[i] /= 2;
      state.mass /= 2;
      out.push({ transfer: newId(), mix: { channel: state.channel, sum: [...state.sum], mass: state.mass } });
    }
    return out;
  }

  // Removes and returns every channel heavy enough to upload without exposing anyone.
  drain(minMass = UPLOAD_MIN_MASS): Mix[] {
    const ready = [...this.states.values()].filter((mix) => mix.mass >= minMass);
    for (const mix of ready) this.states.delete(mix.channel);
    return ready;
  }
}
