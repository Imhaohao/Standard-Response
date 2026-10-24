// Runs the simulated night with the phone mesh on and off over several seeds and writes
// data/flow-results.json for the flow lab and the under-the-hood screen.
//
//   npx tsx scripts/mesh/simulate.ts --seeds 4 --sample 0.3
//
// Simulation, not a prediction: every assumption is listed in the output.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildGround } from "../../lib/crowd/grid";
import { Household } from "../../lib/crowd/langevin";
import { Checkpoint, DEFAULT_WORLD, FlowWorld, WARNING_AT, WorldParams } from "../../lib/flow/world";
import { DEFAULT_TRAINING, UPLOAD_MIN_MASS } from "../../lib/mesh/federated";
import { privacySpent } from "../../lib/mesh/privacy";
import { seededRandom } from "../../lib/mesh/random";
import { DEFAULT_OPTIMIZER, ROUND_MASS } from "../../lib/mesh/rounds";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
};
const SEEDS = arg("seeds", 4);
const SAMPLE = arg("sample", 0.3);
const MINUTES = arg("minutes", 300);
const CELL = arg("cell", 20);

const population = JSON.parse(readFileSync(path.join(root, "data/population.json"), "utf8")) as Household[];
const scenario = JSON.parse(readFileSync(path.join(root, "data/hazard/scenario.geojson"), "utf8"));
const ground = buildGround(CELL, scenario);

const quantile = (values: number[], q: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const summary = (values: number[]) => ({ median: quantile(values, 0.5), p5: quantile(values, 0.05), p95: quantile(values, 0.95), n: values.length });
const round = (value: number | null, digits = 3) => (value === null ? null : Number(value.toFixed(digits)));

// Minutes from a street blocking to the agency first hearing it is blocked.
function reportLatencies(world: FlowWorld) {
  const firstHeard = new Map<string, number>();
  for (const report of world.agency.allReports()) {
    if (report.status !== "blocked") continue;
    const at = world.agency.receivedAt(report.id)!;
    firstHeard.set(report.segment, Math.min(firstHeard.get(report.segment) ?? Infinity, at));
  }
  const latencies: number[] = [];
  const index = new Map(world.ground.segments.map((s, i) => [s.key, i]));
  for (const [segment, at] of firstHeard) {
    const i = index.get(segment);
    if (i === undefined) continue;
    const since = world.blockage.blockedSince(i, MINUTES);
    if (Number.isFinite(since)) latencies.push((at - WARNING_AT) / 60_000 - since);
  }
  return latencies;
}

function runOnce(seed: number, mesh: boolean) {
  const random = seededRandom(1000 + seed);
  const households = population.filter(() => random() < SAMPLE);
  const params: WorldParams = { ...DEFAULT_WORLD, seed, mesh };
  const world = new FlowWorld(ground, households, params);
  const started = Date.now();
  world.run(MINUTES, 15);
  const last = world.timeline[world.timeline.length - 1];
  const contributions = world.nodes.flatMap((node) => (node ? [node.contributions()] : []));
  const travel = world.crowd.travelMinutes();
  return {
    seed,
    mesh,
    households: households.length,
    seconds: (Date.now() - started) / 1000,
    timeline: world.timeline.map(compact),
    final: {
      arrived: last.crowd.arrived,
      overrun: last.crowd.overrun,
      waitingForHelp: last.crowd.waiting,
      discoveries: last.crowd.discoveries,
      travelMedian: quantile(travel, 0.5),
      travelP90: quantile(travel, 0.9),
      trulyBlocked: last.trulyBlocked,
      agencyKnowsBlocked: last.agencyKnowsBlocked,
      phonesKnowBlocked: last.phonesKnowBlocked,
      agencyShareOfSeen: last.phonesKnowBlocked ? last.agencyKnowsBlocked / last.phonesKnowBlocked : null,
      agencyWrongBlocked: last.agencyWrongBlocked,
      reportLatencyMinutes: summary(reportLatencies(world)),
      modelVersion: last.modelVersion,
      massUploaded: last.massUploaded,
      auc: last.auc,
      phonesContributing: contributions.filter((c) => c > 0).length,
      bottlenecks: world.crowd.bottlenecks(8).map((b) => ({
        street: world.ground.segments[b.segment].name || "unnamed road",
        segment: world.ground.segments[b.segment].key,
        carsThrough: b.entries,
        meanSpeedKph: round(b.meanSpeed * 3.6, 1),
        freeSpeedKph: round(b.freeSpeed * 3.6, 1),
      })),
      maxContributionsPerPhone: Math.max(0, ...contributions),
    },
  };
}

function compact(checkpoint: Checkpoint) {
  return {
    minute: checkpoint.minute,
    arrived: checkpoint.crowd.arrived,
    moving: checkpoint.crowd.moving,
    home: checkpoint.crowd.home,
    waiting: checkpoint.crowd.waiting,
    overrun: checkpoint.crowd.overrun,
    jammedShare: round(checkpoint.crowd.jammedShare),
    meanSpeed: round(checkpoint.crowd.meanSpeed, 2),
    discoveries: checkpoint.crowd.discoveries,
    trulyBlocked: checkpoint.trulyBlocked,
    agencyKnowsBlocked: checkpoint.agencyKnowsBlocked,
    phonesKnowBlocked: checkpoint.phonesKnowBlocked,
    phonesKnowingABlockage: checkpoint.phonesKnowingABlockage,
    reports: checkpoint.reports,
    meetings: checkpoint.meetings,
    modelVersion: checkpoint.modelVersion,
    massUploaded: round(checkpoint.massUploaded, 1),
    auc: { shared: round(checkpoint.auc.shared), pooled: round(checkpoint.auc.pooled), initial: round(checkpoint.auc.initial) },
  };
}

type Run = ReturnType<typeof runOnce>;

// Phones that know of at least one blocked street, `minute` minutes after the warning.
const informedAt = (run: Run, minute: number) => run.timeline.find((t) => t.minute === minute)?.phonesKnowingABlockage ?? null;

function compare(on: Run[], off: Run[], pick: (run: Run) => number | null) {
  const values = (runs: Run[]) => runs.map(pick).filter((v): v is number => v !== null);
  const differences = on.map((run, i) => {
    const a = pick(run);
    const b = pick(off[i]);
    return a === null || b === null ? null : a - b;
  });
  return { meshOn: summary(values(on)), meshOff: summary(values(off)), difference: summary(differences.filter((d): d is number => d !== null)) };
}

const on: Run[] = [];
const off: Run[] = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  for (const mesh of [true, false]) {
    const run = runOnce(seed, mesh);
    (mesh ? on : off).push(run);
    console.log(`seed ${seed} mesh ${mesh ? "on " : "off"}: ${run.seconds.toFixed(0)} s, AUC ${run.final.auc.shared.toFixed(2)}, agency knows ${run.final.agencyKnowsBlocked}/${run.final.trulyBlocked} blocked`);
  }
}

const privacy = privacySpent(DEFAULT_TRAINING.noiseMultiplier, DEFAULT_TRAINING.maxContributions);
const results = {
  label: "Simulation, not a prediction",
  generatedAt: new Date().toISOString(),
  seeds: SEEDS,
  householdsPerRun: on[0]?.households ?? 0,
  sample: SAMPLE,
  minutes: MINUTES,
  assumptions: [
    { name: "Households simulated", value: `${Math.round(SAMPLE * 100)}% of data/population.json`, why: "Runtime; densities and meetings scale with it" },
    { name: "Phones", value: `${DEFAULT_WORLD.phoneShare * 100}% of households`, why: "Smartphone ownership among older adults is lower than average" },
    { name: "Radio range", value: `${DEFAULT_WORLD.radioMeters} m`, why: "Bluetooth LE or Wi-Fi Direct outdoors between cars and houses" },
    { name: "Mobile data in the zone", value: `${DEFAULT_WORLD.cellularShare * 100}% of phones, online ${DEFAULT_WORLD.cellularUpChance * 100}% of the time`, why: "Towers lose power and backhaul in a wildfire" },
    { name: "Gateways", value: `${DEFAULT_WORLD.gatewayShare * 100}% of phones agree to upload for others`, why: "Opt-in" },
    { name: "Everyone who reaches safety is online", value: "yes", why: "Shelter Wi-Fi or working networks outside the zone" },
    { name: "Street blockages", value: "logistic in fire proximity, road class and time, spatially clustered", why: "lib/flow/blockage.ts; no published per-street data exists" },
    { name: "Departures", value: "drift-diffusion, keen and reluctant classes", why: "UC Berkeley survey of California wildfire evacuees" },
    { name: "Crowd motion", value: "underdamped Langevin, BAOAB, density-slowed speed", why: "lib/crowd/langevin.ts" },
  ],
  privacy: {
    mechanism: "Gaussian noise on each phone's clipped update (local differential privacy)",
    clip: DEFAULT_TRAINING.clip,
    noiseMultiplier: DEFAULT_TRAINING.noiseMultiplier,
    maxContributionsPerPhone: DEFAULT_TRAINING.maxContributions,
    worstCasePerPhone: { epsilon: round(privacy.epsilon, 2), delta: privacy.delta },
    perContribution: { epsilon: round(privacySpent(DEFAULT_TRAINING.noiseMultiplier, 1).epsilon, 2), delta: privacy.delta },
    uploadMinimumMass: UPLOAD_MIN_MASS,
    roundMass: ROUND_MASS,
    serverOptimizer: DEFAULT_OPTIMIZER,
  },
  results: {
    phonesInformedAt30: compare(on, off, (r) => informedAt(r, 30)),
    phonesInformedAt60: compare(on, off, (r) => informedAt(r, 60)),
    agencyKnowsBlocked: compare(on, off, (r) => r.final.agencyKnowsBlocked),
    phonesKnowBlocked: compare(on, off, (r) => r.final.phonesKnowBlocked),
    agencyShareOfSeen: compare(on, off, (r) => r.final.agencyShareOfSeen),
    reportLatencyMedianMinutes: compare(on, off, (r) => r.final.reportLatencyMinutes.median),
    discoveriesByDriving: compare(on, off, (r) => r.final.discoveries),
    arrived: compare(on, off, (r) => r.final.arrived),
    overrun: compare(on, off, (r) => r.final.overrun),
    travelMedianMinutes: compare(on, off, (r) => r.final.travelMedian),
    sharedModelAuc: compare(on, off, (r) => r.final.auc.shared),
    centralModelAuc: compare(on, off, (r) => r.final.auc.pooled),
  },
  runs: [...on, ...off],
};

writeFileSync(path.join(root, "data/flow-results.json"), JSON.stringify(results, null, 1) + "\n");
console.log("wrote data/flow-results.json");
