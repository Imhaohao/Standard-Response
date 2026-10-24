import { closeRound, emptyRound, freshOptimizerState, OpenRound, OptimizerState, ROUND_MASS, roundIsReady, stalenessWeight } from "../mesh/rounds";
import { isValidMix, Mix, readMix, UpdateBlock, UPLOAD_MIN_MASS } from "./mixing";
import { TALLY_DIMENSIONS, townEstimates } from "./tally";
import { initialModel, sampleRateFor, SURVEY_OPTIMIZER, SurveyModel, TASK_IDS, TASKS, TaskId, taskDimensions } from "./tasks";

// The county's side of the survey. A gateway's upload is a list of mixes (mixing.ts). Each mix's
// counts are added to the survey's running sums, and each model's update block goes into the open
// round for that model, discounted by how many versions behind they were trained (1 / (1 +
// behind), the street model's weighting) and refused beyond MAX_BEHIND. A round holding ROUND_MASS
// households' worth becomes the next version (DP-FedAvg, lib/mesh/rounds.ts). Anything lighter than UPLOAD_MIN_MASS households,
// malformed or out of bounds is refused. convex/prepare.ts keeps this state in tables; the
// simulation keeps it in memory.

export type TaskState = { model: SurveyModel; optimizer: OptimizerState; round: OpenRound };
export type TallyState = { sum: number[]; mass: number; uploads: number };
export type CountyState = { tasks: Record<TaskId, TaskState>; tally: TallyState; refused: number; staleBlocks: number };

export const freshTask = (task: TaskId): TaskState => ({
  model: initialModel(task),
  optimizer: freshOptimizerState(taskDimensions(task)),
  round: emptyRound(0, taskDimensions(task)),
});

export const freshTally = (): TallyState => ({ sum: Array(TALLY_DIMENSIONS).fill(0), mass: 0, uploads: 0 });

export function freshCounty(): CountyState {
  return {
    tasks: Object.fromEntries(TASK_IDS.map((task) => [task, freshTask(task)])) as Record<TaskId, TaskState>,
    tally: freshTally(),
    refused: 0,
    staleBlocks: 0,
  };
}

export type ClosedRound = { task: TaskId; model: SurveyModel; optimizer: OptimizerState; round: OpenRound };
export type UploadResult = { accepted: number; refused: number; closed: ClosedRound[] };

// Updates trained more than this many versions back are refused. The street model allows one, but
// its phones meet every few minutes; a survey's mixes take days to reach a gateway while versions
// advance, and refusing them wasted most updates in the simulation. They count less instead.
export const MAX_BEHIND = 12;

// Adds one model's block of a mix to its open round, or null when the block was trained on a future
// or too old a version.
function addBlock(round: OpenRound, block: UpdateBlock): OpenRound | null {
  const behind = round.baseVersion - block.version;
  if (behind < -1e-6 || behind > MAX_BEHIND) return null;
  const weight = stalenessWeight(behind);
  return {
    baseVersion: round.baseVersion,
    sum: round.sum.map((value, i) => value + weight * block.sum[i]),
    mass: round.mass + weight * block.mass,
    uploads: round.uploads + 1,
    staleMass: round.staleMass + (behind >= 0.5 ? block.mass : 0),
  };
}

// Households that said in the counts they know the task's outcome, so could train its model.
const eligible = (state: CountyState, task: TaskId) => townEstimates(state.tally.sum)[TASKS[task].labelItem].answered;

// Closes the task's round once it holds ROUND_MASS households' worth.
function maybeClose(state: CountyState, task: TaskId, now: number): ClosedRound | null {
  const current = state.tasks[task];
  if (!roundIsReady(current.round, ROUND_MASS)) return null;
  const closed = closeRound(current.model, current.round, now, current.optimizer, SURVEY_OPTIMIZER);
  const model = { ...closed.model, sampleRate: sampleRateFor(eligible(state, task)) };
  const result = { task, model, optimizer: closed.state, round: current.round };
  state.tasks[task] = { model, optimizer: closed.state, round: emptyRound(model.version, taskDimensions(task)) };
  return result;
}

// Applies one upload to the state in place and returns the rounds it closed. A mix's counts are
// kept even when one of its update blocks is refused as too stale; that block alone is dropped.
export function applyUpload(state: CountyState, mixes: Mix[], now: number): UploadResult {
  const result: UploadResult = { accepted: 0, refused: 0, closed: [] };
  for (const mix of mixes) {
    if (!isValidMix(mix) || mix.mass < UPLOAD_MIN_MASS) {
      result.refused += 1;
      continue;
    }
    result.accepted += 1;
    const { counts, updates } = readMix(mix.sum);
    state.tally.sum = state.tally.sum.map((value, i) => value + counts[i]);
    state.tally.mass += mix.mass;
    state.tally.uploads += 1;
    for (const task of TASK_IDS) {
      if (updates[task].mass <= 1e-9) continue;
      const next = addBlock(state.tasks[task].round, updates[task]);
      if (!next) {
        state.staleBlocks += 1;
        continue;
      }
      state.tasks[task].round = next;
      const closed = maybeClose(state, task, now);
      if (closed) result.closed.push(closed);
    }
  }
  state.refused += result.refused;
  return result;
}
