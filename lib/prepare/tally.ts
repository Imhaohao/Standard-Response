import { AREA_COUNT } from "./areas";
import { Random } from "../mesh/random";
import { Answers, QuestionId, Topic } from "./survey";

// Counting sensitive answers by area without anyone reporting their own (federated analytics).
//
// Each counted answer is a yes or no ("can't pay for a week away"). Before it leaves the phone it
// goes through randomized response (Warner 1965): the phone tells the truth with probability
// TRUTH_PROBABILITY and the opposite otherwise. Any single answer is deniable, with a likelihood
// ratio of at most p / (1 - p) = 4, which is ε = ln 4 local differential privacy. Across many
// households the lies cancel in a known way, so the county can still estimate the share.
//
// The draw is made once per answer and kept (permanent randomized response, as in RAPPOR): sending
// the same answer again repeats the same draw, so nothing is learned by asking twice.
//
// A household's counts are a vector with, for its area, one "answered" and one "said yes" entry per
// counted item, zero elsewhere. Vectors add, so the push-sum mixing in node.ts sums them the same
// way it sums model updates, and the county only ever sees sums over five or more households.

export const TRUTH_PROBABILITY = 0.8;
export const TALLY_EPSILON = Math.log(TRUTH_PROBABILITY / (1 - TRUTH_PROBABILITY));

export type TallyItem = { id: string; topic: Topic; question: QuestionId; yes: string[]; label: string };

// What the county counts. `yes` is the answer that counts toward the item; any other answer to the
// question counts as answered. Each item is about the household's need, so higher is worse.
export const TALLY_ITEMS = [
  { id: "noStoredWater", topic: "water", question: "storedWater", yes: ["no"], label: "No three days of drinking water" },
  { id: "failedWaterTest", topic: "water", question: "waterTest", yes: ["failed"], label: "Tap water failed a test" },
  { id: "cantAffordWeek", topic: "money", question: "weekAway", yes: ["no"], label: "Can't pay for a week away" },
  { id: "noStayInsurance", topic: "money", question: "insurance", yes: ["no", "unknown"], label: "No insurance for a place to stay" },
  { id: "poweredDevice", topic: "health", question: "poweredDevice", yes: ["yes"], label: "Needs power for a medical device" },
  { id: "coldMedicine", topic: "health", question: "coldMedicine", yes: ["yes"], label: "Medicine that must stay cold" },
] as const satisfies readonly TallyItem[];

export type TallyItemId = (typeof TALLY_ITEMS)[number]["id"];
export const TALLY_WIDTH = TALLY_ITEMS.length * 2;
export const TALLY_DIMENSIONS = AREA_COUNT * TALLY_WIDTH;

// Untested households didn't answer whether their water failed a test.
const NOT_AN_ANSWER: Partial<Record<TallyItemId, string[]>> = { failedWaterTest: ["untested"] };

export function truthOf(item: (typeof TALLY_ITEMS)[number], answers: Answers): boolean | null {
  const answer = answers[item.question];
  if (answer === undefined || NOT_AN_ANSWER[item.id]?.includes(answer)) return null;
  return (item.yes as readonly string[]).includes(answer);
}

// The kept draws: for each item and true answer, what this phone says. Keyed by the true answer so
// that changing an answer makes one new draw for it, and changing it back reuses the old one.
export type Draws = Record<string, boolean>;

export function randomizedAnswer(itemId: string, truth: boolean, draws: Draws, random: Random) {
  const key = `${itemId}:${truth ? 1 : 0}`;
  if (draws[key] === undefined) draws[key] = random() < TRUTH_PROBABILITY ? truth : !truth;
  return draws[key];
}

// One household's counts for one topic, in its area. Null when it has answered none of them.
export function tallyVector(area: number, topic: Topic, answers: Answers, draws: Draws, random: Random): number[] | null {
  const vector = Array(TALLY_DIMENSIONS).fill(0);
  let any = false;
  TALLY_ITEMS.forEach((item, k) => {
    if (item.topic !== topic) return;
    const truth = truthOf(item, answers);
    if (truth === null) return;
    const offset = area * TALLY_WIDTH + 2 * k;
    vector[offset] = 1;
    vector[offset + 1] = randomizedAnswer(item.id, truth, draws, random) ? 1 : 0;
    any = true;
  });
  return any ? vector : null;
}

// A summed vector is plausible only if every "said yes" is between zero and its "answered", and no
// area-item has more answers than the households mixed into it. Push-sum halves make entries
// fractional, so the checks allow for rounding.
export function isPlausibleTally(sum: readonly number[], mass: number) {
  if (sum.length !== TALLY_DIMENSIONS) return false;
  for (let i = 0; i < sum.length; i += 2) {
    const answered = sum[i];
    const yes = sum[i + 1];
    if (!Number.isFinite(answered) || !Number.isFinite(yes)) return false;
    if (answered < -1e-6 || yes < -1e-6 || yes > answered + 1e-6 || answered > mass + 1e-6) return false;
  }
  return true;
}

export type Estimate = { answered: number; share: number | null; low: number | null; high: number | null };

// The share of households saying yes, unbiased for randomized response:
// E[said yes] = (2p - 1) truly yes + (1 - p) answered. The 95% interval adds the randomized
// response noise, at most p (1 - p) / (2p - 1)^2 per answer, to the usual sampling variance.
export function estimateShare(answered: number, saidYes: number, p = TRUTH_PROBABILITY): Estimate {
  if (answered < 1) return { answered, share: null, low: null, high: null };
  const raw = (saidYes / answered - (1 - p)) / (2 * p - 1);
  const share = Math.min(1, Math.max(0, raw));
  const variance = (share * (1 - share) + (p * (1 - p)) / (2 * p - 1) ** 2) / answered;
  const half = 1.96 * Math.sqrt(variance);
  return { answered, share, low: Math.max(0, share - half), high: Math.min(1, share + half) };
}

export type AreaEstimates = Record<TallyItemId, Estimate>;

// Every area's estimates from the county's summed counts.
export function estimatesFrom(sum: readonly number[]): AreaEstimates[] {
  return Array.from({ length: AREA_COUNT }, (_, area) => {
    const estimates = {} as AreaEstimates;
    TALLY_ITEMS.forEach((item, k) => {
      const offset = area * TALLY_WIDTH + 2 * k;
      estimates[item.id] = estimateShare(sum[offset] ?? 0, sum[offset + 1] ?? 0);
    });
    return estimates;
  });
}

// The whole town, with every area's counts added.
export function townEstimates(sum: readonly number[]): AreaEstimates {
  const estimates = {} as AreaEstimates;
  TALLY_ITEMS.forEach((item, k) => {
    let answered = 0;
    let yes = 0;
    for (let area = 0; area < AREA_COUNT; area++) {
      answered += sum[area * TALLY_WIDTH + 2 * k] ?? 0;
      yes += sum[area * TALLY_WIDTH + 2 * k + 1] ?? 0;
    }
    estimates[item.id] = estimateShare(answered, yes);
  });
  return estimates;
}
