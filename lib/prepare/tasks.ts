import { Example, GlobalModel, predict, TrainingParams } from "../mesh/federated";
import { ROUND_MASS, ServerOptimizer } from "../mesh/rounds";
import { TallyItemId } from "./tally";
import { Answers, Topic } from "./survey";

// The shared models households train together. Each is a logistic regression from survey answers
// to one outcome only some households know about themselves:
//
// - water: will this home's tap water fail a test? Trained by households that have tested. Every
//   household then sees its own risk on its phone, and the county can apply the model to what it
//   already knows about every home (build year from the assessor, pipe material from the water
//   company's lead service line inventory) to decide where test kits and filters go first.
// - money: can this household not pay for a week away? The features are ones the census publishes
//   per block group (income, renting, cars, household size), so the county can apply the model to
//   every block group, including the households that never took part, which corrects for who chose
//   to answer.
//
// Features are standardised by public constants (their mean and spread over the synthetic
// population, scripts/prepare/simulate.ts --scales recomputes them), for the reason given in
// lib/mesh/federated.ts: the privacy noise is the same size in every direction.

export type TaskId = "water" | "money";
export const TASK_IDS: TaskId[] = ["water", "money"];

export type Task = {
  id: TaskId;
  topic: Topic;
  title: string;
  outcome: string;
  featureNames: string[];
  raw: (answers: Answers) => number[];
  label: (answers: Answers) => 0 | 1 | null;
  // The counted item whose "answered" is the households that can train this model.
  labelItem: TallyItemId;
  center: number[];
  scale: number[];
};

const is = (answer: string | undefined, ...values: string[]) => (answer !== undefined && values.includes(answer) ? 1 : 0);

const WATER: Task = {
  id: "water",
  topic: "water",
  title: "Unsafe tap water",
  outcome: "chance tap water fails a test",
  featureNames: ["bias", "private well", "built before 1950", "built 1950 to 1985", "build year unknown", "lead or galvanized pipe", "pipe unknown", "fire damage on the block", "water changed lately"],
  raw: (a) => [
    1,
    is(a.waterSource, "well"),
    is(a.homeBuilt, "before1950"),
    is(a.homeBuilt, "1950to1985"),
    is(a.homeBuilt, "unknown") || (a.homeBuilt === undefined ? 1 : 0),
    is(a.servicePipe, "lead"),
    is(a.servicePipe, "unknown") || (a.servicePipe === undefined ? 1 : 0),
    is(a.fireNearby, "yes"),
    is(a.waterChanged, "yes"),
  ],
  label: (a) => (a.waterTest === "failed" ? 1 : a.waterTest === "passed" ? 0 : null),
  labelItem: "failedWaterTest",
  center: [0, 0.03, 0.51, 0.363, 0.057, 0.113, 0.343, 0.35, 0.124],
  scale: [1, 0.172, 0.5, 0.481, 0.232, 0.317, 0.475, 0.477, 0.33],
};

const MONEY: Task = {
  id: "money",
  topic: "money",
  title: "Can't afford to leave",
  outcome: "chance a week away is out of reach",
  featureNames: ["bias", "income under $35k", "income $35k to $75k", "income $75k to $150k", "rents", "no car", "no insurance for a stay", "paid by the hour", "people at home"],
  raw: (a) => [
    1,
    is(a.income, "under35"),
    is(a.income, "35to75"),
    is(a.income, "75to150"),
    is(a.tenure, "rent"),
    is(a.vehicles, "0"),
    is(a.insurance, "no", "unknown"),
    is(a.hourlyWork, "yes"),
    Math.min(Number(a.householdSize ?? 2), 5) / 5,
  ],
  label: (a) => (a.weekAway === "no" ? 1 : a.weekAway === "yes" ? 0 : null),
  labelItem: "cantAffordWeek",
  center: [0, 0.152, 0.156, 0.273, 0.304, 0.04, 0.537, 0.204, 0.449],
  scale: [1, 0.359, 0.363, 0.446, 0.46, 0.195, 0.499, 0.403, 0.218],
};

export const TASKS: Record<TaskId, Task> = { water: WATER, money: MONEY };

export const taskDimensions = (task: TaskId) => TASKS[task].featureNames.length;

export function featuresOf(task: TaskId, answers: Answers) {
  const { raw, center, scale } = TASKS[task];
  return raw(answers).map((value, i) => (i === 0 ? 1 : (value - center[i]) / scale[i]));
}

// A training example, when the household knows the outcome. Unanswered features read as "not sure".
export function exampleOf(task: TaskId, answers: Answers): Example | null {
  const y = TASKS[task].label(answers);
  if (y === null) return null;
  return { x: featuresOf(task, answers), y };
}

export const riskOf = (task: TaskId, model: GlobalModel, answers: Answers) => predict(model.weights, featuresOf(task, answers));

// A shared model as the county publishes it: the street model's shape plus the share of households
// asked to train this version. Each phone decides once per version, at that rate, whether to take
// part (client sampling, as in every production federated system). Without it every household
// would train the first version at once, and by the time their updates arrived the model would
// have moved on and refused them. The county sets the rate for about COHORT households, from how
// many said in the counts that they know the outcome. Sampling also amplifies privacy; the ε shown
// on phones doesn't count that, so it is an upper bound.
export type SurveyModel = GlobalModel & { sampleRate: number };

export const INITIAL_SAMPLE_RATE = 0.1;
// Twice a round's worth, since some updates are still travelling when the round closes.
export const COHORT = 2 * ROUND_MASS;
const MIN_SAMPLE_RATE = 0.01;

export function sampleRateFor(eligible: number) {
  if (!(eligible > 0)) return INITIAL_SAMPLE_RATE;
  return Math.min(1, Math.max(MIN_SAMPLE_RATE, COHORT / eligible));
}

export const initialModel = (task: TaskId): SurveyModel => ({
  version: 0,
  weights: Array(taskDimensions(task)).fill(0),
  issuedAt: 0,
  contributors: 0,
  sampleRate: INITIAL_SAMPLE_RATE,
});

export function isValidSurveyModel(task: TaskId, value: unknown): value is SurveyModel {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Record<string, unknown>;
  const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  return (
    Number.isInteger(model.version) &&
    (model.version as number) >= 0 &&
    Array.isArray(model.weights) &&
    model.weights.length === taskDimensions(task) &&
    model.weights.every((x) => finite(x) && Math.abs(x) < 1e3) &&
    finite(model.issuedAt) &&
    finite(model.contributors) &&
    finite(model.sampleRate) &&
    (model.sampleRate as number) >= MIN_SAMPLE_RATE &&
    (model.sampleRate as number) <= 1
  );
}

// A household's data is a single example that doesn't change much, so it takes part in at most
// three versions of each model.
export const SURVEY_TRAINING: TrainingParams = {
  maxContributions: 3,
  epochs: 1,
  learningRate: 1,
  l2: 1e-3,
  positiveWeight: 1,
  clip: 1,
  noiseMultiplier: 1.2,
};

// The county's step from each round's averaged update: plain DP-FedAvg, adding the average update
// as it is. A survey gets ten to twenty versions per model in three months, too few for FedAdam's
// fixed-size steps (the street model's choice) to settle; in the simulation they overshot, and
// server momentum overshot too, because late, stale updates keep pushing after the model has
// passed the optimum.
export const SURVEY_OPTIMIZER: ServerOptimizer = { kind: "momentum", learningRate: 1, momentum: 0 };

// Weights as odds ratios, for reading: how many times the odds go up for one spread of the feature.
export const oddsRatio = (weight: number) => Math.exp(weight);
