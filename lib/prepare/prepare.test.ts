import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { auc, fitCentrally } from "../mesh/federated";
import { seededIds, seededRandom } from "../mesh/random";
import { AREA_IDS, areaOf, areaShapes } from "./areas";
import { applyUpload, freshCounty } from "./county";
import { countsVector, isValidMix, readMix, SURVEY_CHANNEL, updateVector, UPLOAD_MIN_MASS, VECTOR_LENGTH } from "./mixing";
import { meet, SurveyPhone } from "./node";
import { Answers, cleanAnswers, QUESTIONS } from "./survey";
import { estimateShare, randomizedAnswer, TALLY_DIMENSIONS, TALLY_EPSILON, TRUTH_PROBABILITY } from "./tally";
import { exampleOf, featuresOf, SURVEY_TRAINING, taskDimensions } from "./tasks";
import { PopulationRecord, synthesize } from "./synthetic";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const AREA = AREA_IDS[3];

const WATER: Answers = { waterSource: "utility", homeBuilt: "before1950", servicePipe: "lead", fireNearby: "yes", waterChanged: "yes", waterTest: "failed", storedWater: "no" };
const MONEY: Answers = { income: "under35", tenure: "rent", vehicles: "0", insurance: "no", hourlyWork: "yes", householdSize: "3", weekAway: "no" };

function makePhone(seed: number, rate = 1) {
  const random = seededRandom(seed);
  const phone = new SurveyPhone({ newId: seededIds(random), random, now: () => 0 });
  for (const task of ["water", "money"] as const) phone.models[task].sampleRate = rate;
  return phone;
}

describe("survey answers", () => {
  it("keeps only known questions with their own options", () => {
    assert.deepEqual(cleanAnswers({ waterSource: "well", income: "a lot", ssn: "123", tenure: 4 }), { waterSource: "well" });
  });

  it("gives every question a way to answer without knowing", () => {
    for (const q of QUESTIONS) assert.ok(q.options.length >= 2, q.id);
  });
});

describe("randomized response", () => {
  it("keeps one draw per answer, so asking again tells nothing new", () => {
    const draws = {};
    const random = seededRandom(4);
    const first = randomizedAnswer("cantAffordWeek", true, draws, random);
    for (let i = 0; i < 20; i++) assert.equal(randomizedAnswer("cantAffordWeek", true, draws, random), first);
  });

  it("is ln 4 differential privacy and estimates the share without bias", () => {
    assert.ok(Math.abs(TALLY_EPSILON - Math.log(4)) < 1e-12);
    const random = seededRandom(5);
    const n = 20_000;
    let said = 0;
    for (let i = 0; i < n; i++) said += randomizedAnswer(`q${i}`, i < 0.3 * n, {}, random) ? 1 : 0;
    const estimate = estimateShare(n, said, TRUTH_PROBABILITY);
    assert.ok(Math.abs(estimate.share! - 0.3) < 0.02, String(estimate.share));
    assert.ok(estimate.low! < 0.3 && estimate.high! > 0.3);
  });
});

describe("a household's phone", () => {
  it("shares nothing until the topic is answered in full and agreed to", () => {
    const phone = makePhone(1);
    phone.setArea(AREA);
    phone.answer({ ...WATER, storedWater: undefined });
    phone.setConsent("water", true);
    assert.equal(phone.pool.totalMass(), 0);
    phone.answer({ storedWater: "no" });
    // One count and one model update, nothing for the topics it didn't agree to.
    assert.equal(phone.pool.totalMass(), 2);
    assert.equal(phone.updates("water"), 1);
    assert.equal(phone.updates("money"), 0);
  });

  it("puts no answer in what it sends: counts are randomized and updates are clipped and noised", () => {
    const phone = makePhone(2);
    phone.setArea(AREA);
    phone.answer(WATER);
    phone.setConsent("water", true);
    const [mix] = phone.pool.all();
    assert.equal(mix.sum.length, VECTOR_LENGTH);
    const { counts, updates } = readMix(mix.sum);
    // Counts carry one "answered" per item of the topic and a randomized yes; nothing else is set.
    assert.equal(counts.filter((x) => x !== 0).length <= 4, true);
    assert.equal(updates.water.mass, 1);
    assert.equal(updates.money.mass, 0);
    assert.ok(isValidMix(mix));
  });

  it("takes part in a version only if the county's sample picks it, and decides once", () => {
    let taking = 0;
    for (let seed = 0; seed < 400; seed++) {
      const phone = makePhone(seed, 0.25);
      phone.answer(MONEY);
      phone.setConsent("money", true);
      phone.setConsent("money", true);
      taking += phone.updates("money");
    }
    assert.ok(taking > 60 && taking < 140, String(taking));
  });

  it("restores without contributing twice", () => {
    const phone = makePhone(3);
    phone.setArea(AREA);
    phone.answer(MONEY);
    phone.setConsent("money", true);
    const copy = makePhone(4);
    copy.restore(JSON.parse(JSON.stringify(phone.snapshot())));
    copy.share();
    assert.equal(copy.pool.totalMass(), phone.pool.totalMass());
    assert.equal(copy.privacy("money").epsilon, phone.privacy("money").epsilon);
  });

  it("counts privacy per topic: model updates plus ln 4 per counted answer", () => {
    const phone = makePhone(5);
    phone.setArea(AREA);
    phone.answer(MONEY);
    phone.setConsent("money", true);
    const spent = phone.privacy("money");
    assert.equal(spent.updates, 1);
    assert.equal(spent.counts, 2);
    assert.ok(spent.epsilon > 2 * TALLY_EPSILON);
    assert.equal(phone.privacy("water").epsilon, 0);
  });
});

describe("mixing between phones", () => {
  it("moves mass toward the gateway, conserving it", () => {
    const gateway = makePhone(10);
    gateway.sink = true;
    const phones = [11, 12, 13, 14, 15, 16].map((seed) => {
      const phone = makePhone(seed);
      phone.setArea(AREA);
      phone.answer(MONEY);
      phone.setConsent("money", true);
      return phone;
    });
    const total = phones.reduce((s, p) => s + p.pool.totalMass(), 0);
    // A chain: the last phone meets the gateway, and each phone meets the next.
    for (let round = 0; round < 30; round++) {
      meet(phones[phones.length - 1], gateway);
      for (let i = 0; i < phones.length - 1; i++) meet(phones[i], phones[i + 1]);
    }
    const held = phones.reduce((s, p) => s + p.pool.totalMass(), 0) + gateway.pool.totalMass();
    assert.ok(Math.abs(held - total) < 1e-9);
    assert.ok(gateway.pool.totalMass() > 0.8 * total, String(gateway.pool.totalMass()));
    assert.ok(phones.every((p) => p.hops() <= phones.length));
  });

  it("refuses malformed or implausible mixes from a peer", () => {
    const phone = makePhone(20);
    const zeros = Array(VECTOR_LENGTH).fill(0);
    assert.ok(!isValidMix({ channel: "other", sum: zeros, mass: 1 }));
    assert.ok(!isValidMix({ channel: SURVEY_CHANNEL, sum: zeros.slice(1), mass: 1 }));
    const tooManyYes = countsVector(Array(TALLY_DIMENSIONS).fill(0).map((_, i) => (i % 2 ? 2 : 1)));
    assert.ok(!isValidMix({ channel: SURVEY_CHANNEL, sum: tooManyYes, mass: 1 }));
    const huge = updateVector("water", Array(taskDimensions("water")).fill(100), 0);
    assert.ok(!isValidMix({ channel: SURVEY_CHANNEL, sum: huge, mass: 1 }));
    assert.deepEqual(phone.receive({ type: "mix", transfer: "t", mix: { channel: SURVEY_CHANNEL, sum: huge, mass: 1 } }), []);
    assert.equal(phone.pool.totalMass(), 0);
  });
});

describe("the county", () => {
  it("refuses mixes of fewer than five households and closes a round at forty", () => {
    const county = freshCounty();
    const light = { channel: SURVEY_CHANNEL, sum: updateVector("money", Array(taskDimensions("money")).fill(0.1), 0), mass: UPLOAD_MIN_MASS - 1 };
    assert.equal(applyUpload(county, [light], 0).refused, 1);
    const random = seededRandom(30);
    let closed = 0;
    for (let i = 0; i < 10; i++) {
      const phones = Array.from({ length: 5 }, (_, k) => {
        const phone = makePhone(100 + i * 5 + k);
        phone.answer(MONEY);
        phone.setConsent("money", true);
        return phone;
      });
      const sum = Array(VECTOR_LENGTH).fill(0);
      for (const phone of phones) for (const mix of phone.pool.all()) mix.sum.forEach((x, j) => (sum[j] += x));
      closed += applyUpload(county, [{ channel: SURVEY_CHANNEL, sum, mass: phones.reduce((s, p) => s + p.pool.totalMass(), 0) }], random()).closed.length;
    }
    assert.equal(closed, 1);
    assert.equal(county.tasks.money.model.version, 1);
  });
});

describe("the models", () => {
  it("are learnable from the synthetic answers (central fit, for comparison only)", () => {
    const records = JSON.parse(readFileSync(path.join(root, "data/population.json"), "utf8")) as PopulationRecord[];
    const households = synthesize(records.slice(0, 4000), seededRandom(40));
    const examples = households.map((h) => exampleOf("money", h.answers)).filter((e) => e !== null);
    const w = fitCentrally(examples);
    assert.ok(auc(w, examples) > 0.7);
    assert.equal(featuresOf("money", households[0].answers).length, taskDimensions("money"));
    assert.ok(SURVEY_TRAINING.maxContributions <= 3);
  });
});

describe("areas", () => {
  it("are the synthetic population's block groups, and a point finds its own", () => {
    const records = JSON.parse(readFileSync(path.join(root, "data/population.json"), "utf8")) as PopulationRecord[];
    assert.deepEqual([...new Set(records.map((r) => r.blockGroup))].sort(), [...AREA_IDS]);
    const shapes = areaShapes(JSON.parse(readFileSync(path.join(root, "data/census/blockgroups.geojson"), "utf8")));
    assert.equal(shapes.length, AREA_IDS.length);
    const sample = records.filter((_, i) => i % 97 === 0);
    const found = sample.filter((r) => areaOf({ lat: r.lat, lng: r.lng }, shapes) === r.blockGroup).length;
    assert.ok(found / sample.length > 0.95, `${found} of ${sample.length}`);
  });
});
