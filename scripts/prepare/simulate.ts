// The readiness survey, simulated over west Altadena's synthetic households.
//
// Households that take part each hold a SurveyPhone (lib/prepare/node.ts) with their synthetic
// answers. Every simulated hour some of them meet a nearby household's phone and mix; volunteer
// gateways upload what they hold to an in-memory county (lib/prepare/county.ts), and phones pick
// up the latest models. At the end it compares what the county learned with the truth.
//
//   npx tsx scripts/prepare/simulate.ts --seeds 3       # writes data/prepare-results.json, ~40 s
//   npx tsx scripts/prepare/simulate.ts --scales        # prints the feature constants for tasks.ts
//   npx tsx --env-file=.env.local scripts/prepare/simulate.ts --publish
//                                                       # also sends every gateway upload to Convex
//
// Simulation, not a prediction: the answers are synthetic (lib/prepare/synthetic.ts).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { auc, Example, fitCentrally, predict } from "../../lib/mesh/federated";
import { seededIds, seededRandom } from "../../lib/mesh/random";
import { AREA_COUNT, AREA_IDS, AREA_INDEX } from "../../lib/prepare/areas";
import { applyUpload, CountyState, freshCounty } from "../../lib/prepare/county";
import { Mix } from "../../lib/prepare/mixing";
import { meet, SurveyPhone } from "../../lib/prepare/node";
import { TOPICS } from "../../lib/prepare/survey";
import { estimatesFrom, TALLY_ITEMS, TallyItemId, townEstimates, truthOf } from "../../lib/prepare/tally";
import { exampleOf, featuresOf, SURVEY_TRAINING, SurveyModel, TASK_IDS, TASKS, TaskId } from "../../lib/prepare/tasks";
import { Household, PopulationRecord, RATES, synthesize } from "../../lib/prepare/synthetic";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};

const SETTINGS = {
  hours: option("hours", 24 * 90), // a three-month survey campaign
  meetChance: 0.25, // per phone per hour: passing a neighbour close enough for Bluetooth or Wi-Fi
  neighbours: 12, // the households each phone is likely to pass: its nearest participants
  gatewayShare: option("gateways", 0.05), // households that agreed to upload for others
  modelFetchChance: 0.1, // per phone per hour: the public model downloaded on any connection
};

const records = JSON.parse(readFileSync(path.join(root, "data/population.json"), "utf8")) as PopulationRecord[];

function nearest(households: Household[], k: number) {
  const metres = (a: Household, b: Household) => {
    const dy = (a.lat - b.lat) * 111_000;
    const dx = (a.lng - b.lng) * 92_000;
    return dx * dx + dy * dy;
  };
  return households.map((h) =>
    households
      .map((other, j) => ({ j, d: other === h ? Infinity : metres(h, other) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map((n) => n.j),
  );
}

type Publisher = ((mixes: Mix[]) => Promise<void>) | null;

function publisher(): Publisher {
  if (!flag("publish")) return null;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Set NEXT_PUBLIC_CONVEX_URL or CONVEX_URL (run with --env-file=.env.local)");
  const client = new ConvexHttpClient(url);
  return async (mixes) => {
    await client.mutation(api.prepare.upload, { mixes });
  };
}

async function runNight(seed: number, publish: Publisher) {
  const random = seededRandom(seed);
  let clock = 0;
  const households = synthesize(records, seededRandom(seed + 1000));
  const takingPart = households.filter((h) => h.participates);
  const phones = takingPart.map((h, i) => {
    const phone = new SurveyPhone({ newId: seededIds(seededRandom(seed * 100_000 + i)), random: seededRandom(seed * 7919 + i), now: () => clock });
    phone.answer(h.answers);
    phone.setArea(h.area);
    for (const topic of TOPICS) phone.setConsent(topic, h.consent[topic]);
    phone.sink = random() < SETTINGS.gatewayShare;
    return phone;
  });
  const near = nearest(takingPart, SETTINGS.neighbours);
  const county = freshCounty();
  const models = (): Record<TaskId, SurveyModel> => ({ water: county.tasks.water.model, money: county.tasks.money.model });
  let uploads = 0;
  let uploadedMass = 0;
  for (let hour = 0; hour < SETTINGS.hours; hour++) {
    clock = hour * 3_600_000;
    phones.forEach((phone, i) => {
      if (random() < SETTINGS.meetChance) meet(phone, phones[near[i][Math.floor(random() * near[i].length)]]);
      if (random() < SETTINGS.modelFetchChance) for (const task of TASK_IDS) phone.adoptModel(task, models()[task]);
    });
    for (const phone of phones) {
      if (!phone.sink) continue;
      const mixes = phone.takeUpload();
      if (mixes.length === 0) continue;
      applyUpload(county, mixes, clock);
      if (publish) await publish(mixes);
      uploads += 1;
      uploadedMass += mixes.reduce((sum, mix) => sum + mix.mass, 0);
      for (const task of TASK_IDS) phone.adoptModel(task, models()[task]);
    }
  }
  return { households, takingPart, phones, county, uploads, uploadedMass };
}

const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;

function evaluateTask(task: TaskId, households: Household[], takingPart: Household[], county: CountyState) {
  const truthOfHousehold = (h: Household) => (task === "water" ? h.truth.waterFails : h.truth.cantAffordWeek);
  // Everyone, scored on the truth: what the county would rank if it applied the model to every home.
  const everyone: Example[] = households.map((h) => ({ x: featuresOf(task, h.answers), y: truthOfHousehold(h) ? 1 : 0 }));
  const shared = takingPart.filter((h) => h.consent[TASKS[task].topic]).map((h) => exampleOf(task, h.answers)).filter((e): e is Example => e !== null);
  const central = fitCentrally(shared);
  const oracle = fitCentrally(everyone);
  const federated = county.tasks[task].model;
  return {
    version: federated.version,
    householdsWorth: round(federated.contributors, 1),
    labelledHouseholds: shared.length,
    auc: { federated: round(auc(federated.weights, everyone)), centralOnSameData: round(auc(central, everyone)), oracle: round(auc(oracle, everyone)) },
    weights: TASKS[task].featureNames.map((name, i) => ({ name, federated: round(federated.weights[i], 2), central: round(central[i], 2) })),
    meanPredicted: round(everyone.reduce((s, e) => s + predict(federated.weights, e.x), 0) / everyone.length),
    trueShare: round(everyone.reduce((s, e) => s + e.y, 0) / everyone.length),
  };
}

type Coverage = { item: TallyItemId; town: { estimate: number | null; low: number | null; high: number | null; truthAmongShared: number; truthEveryone: number }; areaCoverage: number; meanHalfWidth: number; areasWithAnswers: number };

function evaluateTallies(households: Household[], takingPart: Household[], county: CountyState): Coverage[] {
  const perArea = estimatesFrom(county.tally.sum);
  const town = townEstimates(county.tally.sum);
  return TALLY_ITEMS.map((item) => {
    const shared = takingPart.filter((h) => h.consent[item.topic] && truthOf(item, h.answers) !== null);
    const share = (list: Household[]) => list.filter((h) => truthOf(item, h.answers)).length / Math.max(list.length, 1);
    const everyone = households.filter((h) => truthOf(item, h.answers) !== null);
    let covered = 0;
    let counted = 0;
    let width = 0;
    AREA_IDS.forEach((area, a) => {
      const estimate = perArea[a][item.id];
      if (estimate.share === null || estimate.answered < 20) return;
      const truth = share(shared.filter((h) => h.area === area));
      counted += 1;
      width += (estimate.high! - estimate.low!) / 2;
      if (truth >= estimate.low! && truth <= estimate.high!) covered += 1;
    });
    const t = town[item.id];
    return {
      item: item.id,
      town: { estimate: t.share === null ? null : round(t.share), low: t.low === null ? null : round(t.low), high: t.high === null ? null : round(t.high), truthAmongShared: round(share(shared)), truthEveryone: round(share(everyone)) },
      areaCoverage: counted ? round(covered / counted, 2) : 0,
      meanHalfWidth: counted ? round(width / counted) : 0,
      areasWithAnswers: counted,
    };
  });
}

// Poststratification: the money model applied to every household, participant or not, against the
// raw count from participants only, who are better off on average because poorer households take
// part less (RATES.participateLowIncomeCut).
function evaluateCorrection(households: Household[], county: CountyState) {
  const model = county.tasks.money.model;
  const town = townEstimates(county.tally.sum).cantAffordWeek;
  const predicted = households.reduce((s, h) => s + predict(model.weights, featuresOf("money", h.answers)), 0) / households.length;
  const truth = households.filter((h) => h.truth.cantAffordWeek).length / households.length;
  return { rawCount: town.share === null ? null : round(town.share), modelOverEveryone: round(predicted), truth: round(truth) };
}

function scales() {
  const households = synthesize(records, seededRandom(1000));
  for (const task of TASK_IDS) {
    const rows = households.map((h) => TASKS[task].raw(h.answers));
    const center = rows[0].map((_, i) => (i === 0 ? 0 : rows.reduce((s, r) => s + r[i], 0) / rows.length));
    const scale = rows[0].map((_, i) => (i === 0 ? 1 : Math.sqrt(rows.reduce((s, r) => s + (r[i] - center[i]) ** 2, 0) / rows.length) || 1));
    console.log(`${task}\n  center: [${center.map((x) => round(x)).join(", ")}]\n  scale: [${scale.map((x) => round(x)).join(", ")}]`);
  }
}

async function main() {
  if (flag("scales")) return scales();
  const seeds = option("seeds", 1);
  const publish = publisher();
  const runs = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const started = Date.now();
    const night = await runNight(seed, publish);
    const contributed = night.phones.reduce((s, p) => s + TOPICS.filter((t) => p.isCounted(t)).length + TASK_IDS.reduce((n, task) => n + p.updates(task), 0), 0);
    const epsilons = night.phones.flatMap((p) => TOPICS.map((t) => p.privacy(t).epsilon)).filter((e) => e > 0).sort((a, b) => a - b);
    const run = {
      seed,
      households: night.households.length,
      takingPart: night.takingPart.length,
      uploads: night.uploads,
      meanMassPerUpload: round(night.uploadedMass / Math.max(night.uploads, 1), 1),
      reachedCounty: round(night.uploadedMass / Math.max(contributed, 1), 3),
      refused: night.county.refused,
      privacy: { medianEpsilonPerTopic: round(epsilons[Math.floor(epsilons.length / 2)] ?? 0, 2), maxEpsilonPerTopic: round(epsilons[epsilons.length - 1] ?? 0, 2) },
      models: Object.fromEntries(TASK_IDS.map((task) => [task, evaluateTask(task, night.households, night.takingPart, night.county)])),
      tallies: evaluateTallies(night.households, night.takingPart, night.county),
      participationBias: evaluateCorrection(night.households, night.county),
    };
    console.log(JSON.stringify({ ...run, seconds: Math.round((Date.now() - started) / 1000) }, null, 1));
    runs.push(run);
  }
  const results = {
    label: "Simulation, not a prediction. Synthetic answers on Track D's synthetic population; rates assumed in lib/prepare/synthetic.ts.",
    settings: { ...SETTINGS, training: SURVEY_TRAINING, rates: RATES, areas: AREA_COUNT, areaIndexSize: AREA_INDEX.size },
    runs,
  };
  writeFileSync(path.join(root, "data/prepare-results.json"), JSON.stringify(results, null, 1) + "\n");
}

void main();
