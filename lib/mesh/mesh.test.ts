import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auc, DIMENSIONS, Example, featuresOf, INITIAL_MODEL, isValidMix, MixPool, predict, trainLocally, UPLOAD_MIN_MASS } from "./federated";
import { meet, MeshNode } from "./node";
import { gaussianDelta, gaussianEpsilon, privacySpent, privatize } from "./privacy";
import { gaussian, seededIds, seededRandom } from "./random";
import { consensusOf, isValidReport, makeReport, ReportStore, TIME_BUCKET_MS } from "./reports";
import { addToRound, closeRound, emptyRound, roundIsReady } from "./rounds";
import { nearestSegment, segmentKeyOf, SEGMENT_LIST } from "./roads";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const SEGMENT = "100-200-0";

function makeNode(seed: number, now = () => NOW) {
  const random = seededRandom(seed);
  return new MeshNode({ newId: seededIds(random), random, now });
}

describe("road reports", () => {
  it("rounds the time down to the minute and carries nothing else", () => {
    const report = makeReport({ segment: SEGMENT, status: "blocked", observedAt: NOW + 42_123 }, seededIds(seededRandom(1)));
    assert.equal(report.observedAt % TIME_BUCKET_MS, 0);
    assert.deepEqual(Object.keys(report).sort(), ["hops", "id", "observedAt", "segment", "status"]);
  });

  it("refuses malformed, future and expired reports", () => {
    const good = makeReport({ segment: SEGMENT, status: "clear", observedAt: NOW }, seededIds(seededRandom(2)));
    assert.ok(isValidReport(good, NOW));
    assert.ok(!isValidReport({ ...good, status: "open" }, NOW));
    assert.ok(!isValidReport({ ...good, segment: "Lincoln Ave" }, NOW));
    assert.ok(!isValidReport({ ...good, observedAt: NOW + 60 * 60_000 }, NOW));
    assert.ok(!isValidReport({ ...good, observedAt: NOW - 7 * 60 * 60_000 }, NOW));
    assert.ok(!isValidReport({ ...good, hops: -1 }, NOW));
  });

  it("merges in any order to the same set, counting duplicates once", () => {
    const ids = seededIds(seededRandom(3));
    const reports = Array.from({ length: 30 }, (_, i) =>
      makeReport({ segment: `${i % 5}-9-0`, status: i % 3 ? "blocked" : "clear", observedAt: NOW - i * 60_000 }, ids),
    );
    const forward = new ReportStore();
    const backward = new ReportStore();
    forward.add(reports, NOW);
    backward.add([...reports].reverse(), NOW);
    backward.add(reports, NOW);
    assert.deepEqual(forward.ids().sort(), backward.ids().sort());
    assert.equal(forward.size, 30);
  });

  it("lets a recent clear report outvote an old blocked one", () => {
    const ids = seededIds(seededRandom(4));
    const old = makeReport({ segment: SEGMENT, status: "blocked", observedAt: NOW - 120 * 60_000 }, ids);
    const recent = makeReport({ segment: SEGMENT, status: "clear", observedAt: NOW - 60_000 }, ids);
    assert.equal(consensusOf(SEGMENT, [old], NOW).status, "unknown");
    assert.equal(consensusOf(SEGMENT, [old, recent], NOW).status, "clear");
    assert.equal(consensusOf(SEGMENT, [makeReport({ segment: SEGMENT, status: "blocked", observedAt: NOW }, ids)], NOW).status, "blocked");
  });
});

describe("road segments", () => {
  it("names both directions of a street the same way", () => {
    assert.equal(segmentKeyOf("200-100-0"), segmentKeyOf("100-200-0"));
    const segment = SEGMENT_LIST.find((s) => s.edges.length === 2);
    assert.ok(segment, "the graph has two-way streets");
  });

  it("finds the segment under a tap", () => {
    const segment = SEGMENT_LIST[100];
    assert.equal(nearestSegment(segment.mid)?.key, segment.key);
  });
});

describe("meetings", () => {
  it("passes reports and the newer model both ways", () => {
    const a = makeNode(10);
    const b = makeNode(11);
    a.report(SEGMENT, "blocked", "fire");
    b.report("300-400-0", "clear");
    b.adoptModel({ ...INITIAL_MODEL, version: 3, weights: Array(DIMENSIONS).fill(0.5) });
    const result = meet(a, b);
    assert.equal(a.reports.size, 2);
    assert.equal(b.reports.size, 2);
    assert.equal(a.model.version, 3);
    assert.ok(result.a.modelUpdated);
    assert.equal(a.reports.forSegment("300-400-0")[0].hops, 1);
  });

  it("relays across a chain of phones that never meet the source", () => {
    const chain = Array.from({ length: 6 }, (_, i) => makeNode(20 + i));
    chain[0].report(SEGMENT, "blocked");
    for (let i = 0; i < chain.length - 1; i++) meet(chain[i], chain[i + 1]);
    const far = chain[chain.length - 1].reports.forSegment(SEGMENT);
    assert.equal(far.length, 1);
    assert.equal(far[0].hops, 5);
  });

  it("ignores garbage from a peer", () => {
    const a = makeNode(30);
    assert.deepEqual(a.receive("hello"), []);
    assert.deepEqual(a.receive({ type: "hello", protocol: 99, session: "x", have: [], modelVersion: 0 }), []);
    a.receive({ type: "reports", reports: [{ id: "zz", segment: SEGMENT, status: "blocked", observedAt: NOW, hops: 0 }] });
    a.receive({ type: "mix", transfer: "t", mix: { version: 0, sum: [1e9, 0, 0, 0, 0, 0, 0], mass: 1 } });
    a.receive({ type: "model", model: { version: 5, weights: [1], issuedAt: 0, contributors: 0 } });
    assert.equal(a.reports.size, 0);
    assert.equal(a.pool.totalMass(), 0);
    assert.equal(a.model.version, 0);
  });
});

describe("push-sum aggregation", () => {
  it("conserves mass and the average under random meetings, and drains exactly", () => {
    const random = seededRandom(40);
    const nodes = Array.from({ length: 40 }, (_, i) => makeNode(100 + i));
    const updates = nodes.map(() => Array.from({ length: DIMENSIONS }, () => gaussian(random)));
    nodes.forEach((node, i) => node.pool.contribute(0, updates[i]));
    for (let step = 0; step < 400; step++) {
      const i = Math.floor(random() * nodes.length);
      const j = (i + 1 + Math.floor(random() * (nodes.length - 1))) % nodes.length;
      meet(nodes[i], nodes[j]);
    }
    const total = nodes.reduce((mass, node) => mass + node.pool.totalMass(), 0);
    assert.ok(Math.abs(total - nodes.length) < 1e-9);

    const uploaded = nodes.flatMap((node) => node.pool.drain(0));
    const mass = uploaded.reduce((sum, mix) => sum + mix.mass, 0);
    const mean = updates[0].map((_, d) => updates.reduce((sum, u) => sum + u[d], 0) / updates.length);
    const estimate = mean.map((_, d) => uploaded.reduce((sum, mix) => sum + mix.sum[d], 0) / mass);
    estimate.forEach((value, d) => assert.ok(Math.abs(value - mean[d]) < 1e-9));
  });

  it("never lets a phone upload less than the minimum mass", () => {
    const pool = new MixPool();
    pool.contribute(0, Array(DIMENSIONS).fill(0.1));
    assert.deepEqual(pool.drain(UPLOAD_MIN_MASS), []);
    assert.equal(pool.totalMass(), 1);
  });

  it("applies a transfer once even if it arrives twice", () => {
    const pool = new MixPool();
    const mix = { version: 0, sum: Array(DIMENSIONS).fill(0.1), mass: 0.5 };
    assert.ok(pool.absorb(mix, "abc"));
    assert.ok(!pool.absorb(mix, "abc"));
    assert.equal(pool.totalMass(), 0.5);
  });
});

describe("privacy", () => {
  it("returns the epsilon that meets delta, and more noise gives a smaller epsilon", () => {
    const epsilon = gaussianEpsilon(1, 1e-5);
    assert.ok(Math.abs(gaussianDelta(1, epsilon) - 1e-5) < 1e-7);
    assert.ok(privacySpent(2, 1).epsilon < privacySpent(1, 1).epsilon);
    assert.ok(privacySpent(1.5, 4).epsilon > privacySpent(1.5, 1).epsilon);
    assert.equal(privacySpent(1.5, 0).epsilon, 0);
  });

  it("clips before adding noise", () => {
    const zeroNoise = privatize([30, 40], 1, 0, seededRandom(5));
    assert.ok(Math.abs(Math.hypot(...zeroNoise) - 1) < 1e-12);
  });
});

function syntheticExamples(random: () => number, count: number, truth: number[]): Example[] {
  return Array.from({ length: count }, () => {
    const x = featuresOf({
      minutesToFire: -60 + random() * 300,
      kph: 25 + random() * 50,
      lanes: 1 + Math.floor(random() * 4),
      minutesSinceWarning: random() * 300,
      nearbyBlockedShare: random(),
    });
    return { x, y: random() < predict(truth, x) ? 1 : 0 };
  });
}

const TRUTH = [-3, 3.5, 2, 1, -0.5, 0.3, 1.5];

describe("federated learning", () => {
  it("learns on one phone", () => {
    const random = seededRandom(50);
    const train = syntheticExamples(random, 400, TRUTH);
    const test = syntheticExamples(random, 400, TRUTH);
    const weights = trainLocally(INITIAL_MODEL.weights, train, { epochs: 20, learningRate: 0.1, l2: 0, clip: 1, noiseMultiplier: 0 }, random);
    assert.ok(auc(weights, test) > 0.8);
  });

  it("improves the shared model from noised updates mixed over the mesh", () => {
    const random = seededRandom(60);
    const nodes = Array.from({ length: 80 }, (_, i) => makeNode(200 + i));
    for (const node of nodes) for (const example of syntheticExamples(random, 12, TRUTH)) node.observe(example);
    const test = syntheticExamples(random, 600, TRUTH);
    for (const node of nodes.slice(0, 8)) node.sink = true;
    let model = INITIAL_MODEL;
    for (let round = 0; round < 12; round++) {
      for (const node of nodes) node.adoptModel(model);
      for (let step = 0; step < 300; step++) meet(nodes[Math.floor(random() * 80)], nodes[Math.floor(random() * 80)]);
      let open = emptyRound(model.version);
      for (const node of nodes.slice(0, 8)) {
        for (const mix of node.pool.drain(UPLOAD_MIN_MASS)) {
          assert.ok(isValidMix(mix));
          open = addToRound(open, mix) ?? open;
        }
      }
      if (roundIsReady(open, 10)) model = closeRound(model, open, NOW);
    }
    assert.ok(model.version >= 6, `model reached version ${model.version}`);
    assert.ok(auc(model.weights, test) > 0.75, `AUC ${auc(model.weights, test)}`);
  });
});
