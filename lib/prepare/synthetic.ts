import { gaussian, Random } from "../mesh/random";
import { sigmoid } from "../mesh/federated";
import { Answers, Topic } from "./survey";

// Synthetic survey answers for the simulation, built on Track D's synthetic population
// (data/population.json: real ACS PUMS households reweighted to west Altadena's block groups). The
// population gives where each household lives, its size, ages, cars and medical needs. Everything
// else here is assumed, with rates stated below, and the outcomes come from known logistic models
// so the simulation can check what federated learning recovers. Not real people, and not a
// prediction of west Altadena's real answers.

export type PopulationRecord = {
  id: string;
  lat: number;
  lng: number;
  age: number;
  peopleCount: number;
  mobility: string;
  medical: string[];
  hasCar: boolean;
  blockGroup: string;
};

export type Household = {
  id: string;
  area: string;
  lat: number;
  lng: number;
  answers: Answers;
  // The truth behind the answers the household can't give ("Not sure", or never tested).
  truth: { waterFails: boolean; cantAffordWeek: boolean };
  // Takes part at all, and for which topics.
  participates: boolean;
  consent: Record<Topic, boolean>;
};

// The outcome models, on the raw 0/1 facts (not the household's answers, which can be "Not sure").
export const TRUE_WATER = { bias: -3.2, well: 1.6, before1950: 1.2, from1950to1985: 0.6, leadPipe: 1.3, fireNearby: 1.5, waterChanged: 1.1 };
export const TRUE_MONEY = { bias: -2.4, under35: 2.4, from35to75: 1.3, from75to150: 0.5, rents: 0.6, noCar: 0.9, noStayInsurance: 0.7, hourly: 0.6, perExtraPerson: 0.25 };

// Assumed rates.
export const RATES = {
  participate: 0.4, // households with the app that open the survey
  participateLowIncomeCut: 0.15, // lower-income households take part less, so raw counts are biased
  consent: { water: 0.85, money: 0.55, health: 0.7 } as Record<Topic, number>,
  tested: 0.25, // households that have ever tested their tap water
  testedIfChanged: 0.6,
  pipeUnknown: 0.35,
  builtUnknown: 0.06,
  insuranceUnknown: 0.2,
  well: 0.03,
};

const pick = <T,>(random: Random, weights: [T, number][]): T => {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let draw = random() * total;
  for (const [value, w] of weights) if ((draw -= w) <= 0) return value;
  return weights[weights.length - 1][0];
};

type AreaEffect = { older: number; income: number; fire: number };

// Each block group shifts home age, income and fire damage a little, so areas differ.
function areaEffects(records: PopulationRecord[], random: Random) {
  const lats = records.map((r) => r.lat);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const effects = new Map<string, AreaEffect>();
  for (const record of records) {
    if (effects.has(record.blockGroup)) continue;
    // The Eaton fire burned down from the foothills, so northern block groups saw more damage.
    const northness = (record.lat - south) / Math.max(north - south, 1e-9);
    effects.set(record.blockGroup, { older: 0.4 * gaussian(random), income: 0.6 * gaussian(random), fire: 0.1 + 0.55 * northness });
  }
  return effects;
}

function incomeBand(record: PopulationRecord, effect: AreaEffect, random: Random) {
  const score = effect.income + (record.hasCar ? 0.6 : -1.4) + (record.age >= 65 ? -0.5 : 0.2) + gaussian(random);
  return score < -0.7 ? "under35" : score < 0 ? "35to75" : score < 0.9 ? "75to150" : "over150";
}

// Lead service lines by build year; plumbing codes dropped lead first, then galvanized steel.
const LEAD_PIPE_RATE: Record<string, number> = { before1950: 0.25, "1950to1985": 0.1, after1986: 0.01 };

function waterLogit(built: string, well: boolean, leadPipe: boolean, fireNearby: boolean, changed: boolean) {
  const t = TRUE_WATER;
  return t.bias + t.well * +well + t.before1950 * +(built === "before1950") + t.from1950to1985 * +(built === "1950to1985") + t.leadPipe * +leadPipe + t.fireNearby * +fireNearby + t.waterChanged * +changed;
}

function waterOf(record: PopulationRecord, effect: AreaEffect, random: Random) {
  const built = pick(random, [
    ["before1950", 0.55 + 0.2 * effect.older],
    ["1950to1985", 0.38],
    ["after1986", Math.max(0.02, 0.07 - 0.05 * effect.older)],
  ]);
  const well = random() < RATES.well;
  const leadPipe = random() < LEAD_PIPE_RATE[built];
  const fireNearby = random() < effect.fire;
  const changed = random() < 0.06 + 0.15 * (fireNearby ? 1 : 0) + 0.05 * (leadPipe ? 1 : 0);
  const fails = random() < sigmoid(waterLogit(built, well, leadPipe, fireNearby, changed));
  const tested = random() < (changed ? RATES.testedIfChanged : RATES.tested);
  const answers: Answers = {
    waterSource: well ? "well" : "utility",
    homeBuilt: random() < RATES.builtUnknown ? "unknown" : built,
    servicePipe: random() < RATES.pipeUnknown ? "unknown" : leadPipe ? "lead" : "safe",
    fireNearby: fireNearby ? "yes" : "no",
    waterChanged: changed ? "yes" : "no",
    waterTest: tested ? (fails ? "failed" : "passed") : "untested",
    storedWater: random() < 0.35 + (record.age >= 65 ? 0.1 : 0) ? "yes" : "no",
  };
  return { answers, fails };
}

function moneyLogit(income: string, rents: boolean, noCar: boolean, noStayInsurance: boolean, hourly: boolean, people: number) {
  const t = TRUE_MONEY;
  const band = income === "under35" ? t.under35 : income === "35to75" ? t.from35to75 : income === "75to150" ? t.from75to150 : 0;
  return t.bias + band + t.rents * +rents + t.noCar * +noCar + t.noStayInsurance * +noStayInsurance + t.hourly * +hourly + t.perExtraPerson * Math.max(0, people - 2);
}

const sizeAnswer = (people: number) => (people <= 1 ? "1" : people === 2 ? "2" : people <= 4 ? "3" : "5");

function moneyOf(record: PopulationRecord, effect: AreaEffect, random: Random) {
  const income = incomeBand(record, effect, random);
  const low = income === "under35" || income === "35to75";
  const rents = random() < (low ? 0.55 : 0.2);
  const insured = random() < (rents ? 0.3 : 0.7);
  const insurance = random() < RATES.insuranceUnknown ? "unknown" : insured ? "yes" : "no";
  const hourly = record.age < 65 && random() < (low ? 0.55 : 0.25);
  const noCar = !record.hasCar;
  const cantAfford = random() < sigmoid(moneyLogit(income, rents, noCar, insurance !== "yes", hourly, record.peopleCount));
  const answers: Answers = {
    income,
    tenure: rents ? "rent" : "own",
    vehicles: noCar ? "0" : random() < 0.5 ? "1" : "2",
    insurance,
    hourlyWork: hourly ? "yes" : "no",
    householdSize: sizeAnswer(record.peopleCount),
    weekAway: cantAfford ? "no" : "yes",
  };
  return { answers, cantAfford };
}

function healthOf(record: PopulationRecord, random: Random): Answers {
  const powered = record.medical.includes("oxygen") || record.mobility === "power_wheelchair" || random() < 0.04;
  return {
    poweredDevice: powered ? "yes" : "no",
    coldMedicine: random() < 0.06 + (record.age >= 65 ? 0.06 : 0) ? "yes" : "no",
  };
}

export function synthesize(records: PopulationRecord[], random: Random): Household[] {
  const effects = areaEffects(records, random);
  return records.map((record) => {
    const effect = effects.get(record.blockGroup)!;
    const water = waterOf(record, effect, random);
    const money = moneyOf(record, effect, random);
    const answers = { ...water.answers, ...money.answers, ...healthOf(record, random) };
    const participates = random() < RATES.participate - (answers.income === "under35" ? RATES.participateLowIncomeCut : 0);
    const consent = { water: random() < RATES.consent.water, money: random() < RATES.consent.money, health: random() < RATES.consent.health };
    return {
      id: record.id,
      area: record.blockGroup,
      lat: record.lat,
      lng: record.lng,
      answers,
      truth: { waterFails: water.fails, cantAffordWeek: money.cantAfford },
      participates,
      consent,
    };
  });
}
