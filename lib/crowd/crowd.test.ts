import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { gaussian, seededRandom } from "../mesh/random";
import { DEFAULT_DEPARTURE, stepDecision } from "./departure";
import { advance, FORECAST_HORIZON_MINUTES, FORECAST_WINDOWS, rangeOf, TrafficEnsemble } from "./forecast";
import { buildGround, cellIndex, toLatLng, toXY } from "./grid";
import { EDGES } from "../../convex/roadGraph";
import { CrowdSim, DEFAULT_CROWD, Household, ouCoefficients, speedShare, STATE } from "./langevin";
import { JAM_SPACING_METERS, MIN_SPEED_SHARE, RoadRouter } from "./navigation";

const scenario = JSON.parse(readFileSync(new URL("../../data/hazard/scenario.geojson", import.meta.url), "utf8"));
const ground = buildGround(30, scenario);
const population = JSON.parse(readFileSync(new URL("../../data/population.json", import.meta.url), "utf8")) as Household[];

describe("ground", () => {
  it("round-trips coordinates and rasterises streets", () => {
    const point = { lat: 34.19, lng: -118.15 };
    const [x, y] = toXY(point);
    const back = toLatLng(x, y);
    assert.ok(Math.abs(back.lat - point.lat) < 1e-9 && Math.abs(back.lng - point.lng) < 1e-9);
    const roadCells = ground.segmentsAt.filter((s) => s.length > 0).length;
    assert.ok(roadCells > 1000, `${roadCells} road cells`);
  });

  it("knows when the scenario fire reaches the north of the town before the south", () => {
    const north = ground.fireMinutes[cellIndex(ground, ...toXY({ lat: 34.205, lng: -118.13 }))];
    const south = ground.fireMinutes[cellIndex(ground, ...toXY({ lat: 34.15, lng: -118.15 }))];
    assert.ok(north < south, `north ${north} south ${south}`);
  });
});

describe("route choice", () => {
  const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);

  it("reaches safety from almost every intersection and goes downhill in the potential", () => {
    const potential = router.potential(0, new Set());
    const reachable = potential.phi.filter(Number.isFinite).length;
    assert.ok(reachable / potential.phi.length > 0.9);
    const start = router.nearestNode(...toXY({ lat: 34.19, lng: -118.155 }));
    const edge = router.nextEdge(start, potential, new Set());
    assert.ok(edge >= 0);
    assert.ok(potential.phi[router.edgeEnd(edge)] < potential.phi[start]);
  });

  it("routes around a street the driver knows is blocked", () => {
    const start = router.nearestNode(...toXY({ lat: 34.19, lng: -118.155 }));
    const open = router.potential(0, new Set());
    const first = router.nextEdge(start, open, new Set());
    const blocked = new Set([router.edgeSegment[first]]);
    const around = router.potential(0, blocked);
    const second = router.nextEdge(start, around, blocked);
    assert.notEqual(router.edgeSegment[second], router.edgeSegment[first]);
    assert.ok(around.phi[start] >= open.phi[start]);
  });

  it("won't route through streets the fire has reached", () => {
    const late = router.potential(240, new Set());
    for (let e = 0; e < router.edgeFire.length; e++) {
      if (router.edgeFire[e] <= 240) assert.equal(router.edgeSeconds(e, 240, new Set()), Infinity);
    }
    assert.ok(late.phi.filter(Number.isFinite).length < router.potential(0, new Set()).phi.filter(Number.isFinite).length);
  });

  it("slows a street by the cars on it, down to a standstill floor", () => {
    const cars = new Float64Array(router.edgeJamCars.length);
    assert.ok(router.delays(cars).every((d) => d === 1));
    const e = router.edgeJamCars.findIndex((jam) => jam >= 4);
    cars[e] = router.edgeJamCars[e] / 2;
    assert.ok(Math.abs(router.delays(cars)[e] - 2) < 1e-9);
    cars[e] = router.edgeJamCars[e] * 3;
    assert.equal(router.delays(cars)[e], 1 / MIN_SPEED_SHARE);
  });

  it("routes around a jammed street", () => {
    const start = router.nearestNode(...toXY({ lat: 34.19, lng: -118.155 }));
    const open = router.potential(0, new Set());
    const first = router.nextEdge(start, open, new Set());
    const cars = new Float64Array(router.edgeJamCars.length);
    cars[first] = router.edgeJamCars[first];
    const jammed = router.potential(0, new Set(), router.delays(cars));
    assert.ok(jammed.phi[start] > open.phi[start]);
    assert.notEqual(router.nextEdge(start, jammed, new Set()), first);
  });

  it("spreads drivers over downhill streets with logit odds, and never sends one uphill", () => {
    const potential = router.potential(0, new Set());
    const none = new Set<number>();
    const seconds = (edge: number) => router.edgeSeconds(edge, 0, none) + potential.phi[router.edgeEnd(edge)];
    const downhill = (node: number) =>
      Array.from(router.edgeJamCars.keys()).filter((e) => router.edgeStart(e) === node && potential.phi[router.edgeEnd(e)] < potential.phi[node]);
    // An intersection with two downhill streets less than a minute apart.
    let node = -1;
    for (let n = 0; n < potential.phi.length && node < 0; n++) {
      const options = downhill(n).map(seconds).sort((a, b) => a - b);
      if (options.length === 2 && options[1] - options[0] > 5 && options[1] - options[0] < 60) node = n;
    }
    assert.ok(node >= 0);
    const [a, b] = downhill(node);
    const random = seededRandom(9);
    const draws = 20_000;
    let takenA = 0;
    for (let k = 0; k < draws; k++) {
      const edge = router.chooseEdge(node, potential, none, 60, random);
      assert.ok(edge === a || edge === b, `uphill edge ${edge}`);
      if (edge === a) takenA += 1;
    }
    const expected = 1 / (1 + Math.exp((seconds(a) - seconds(b)) / 60));
    assert.ok(Math.abs(takenA / draws - expected) < 0.015, `${takenA / draws} vs ${expected}`);
    assert.equal(router.chooseEdge(node, potential, none, 0, random), router.nextEdge(node, potential, none));
  });
});

describe("Langevin dynamics", () => {
  // A long one-lane street whose first stretch is straight, away from fire and safety, with its
  // start and direction.
  const straightStreet = (router: RoadRouter, metres: number) => {
    const firstStretch = (k: number) => Math.hypot(router.edgeShape[k][2] - router.edgeShape[k][0], router.edgeShape[k][3] - router.edgeShape[k][1]);
    const edge = EDGES.findIndex((e, k) => firstStretch(k) > metres && router.edgeLanes[k] === 1 && router.edgeFire[k] > 200 && !router.safe[e.v]);
    assert.ok(edge >= 0);
    const [ax, ay, bx, by] = router.edgeShape[edge];
    const length = firstStretch(edge);
    const ux = (bx - ax) / length;
    const uy = (by - ay) / length;
    const at = (m: number): Household => ({ ...toLatLng(ax + ux * m, ay + uy * m), peopleCount: 1, canLeave: "yes", hasCar: true });
    const along = (sim: CrowdSim, i: number) => (sim.x[i] - ax) * ux + (sim.y[i] - ay) * uy;
    return { edge, at, along };
  };

  const onStreet = (sim: CrowdSim, edge: number) => {
    for (let i = 0; i < sim.count; i++) {
      sim.state[i] = STATE.moving;
      sim.edge[i] = edge;
      sim.point[i] = 1;
      sim.goal[i] = sim.router.edgeStart(edge);
    }
  };

  it("keeps velocity noise at the stated variance", () => {
    const { c1, c2 } = ouCoefficients(0.5, 2, 0.6);
    const random = seededRandom(1);
    let v = 0;
    let sum = 0;
    const steps = 200_000;
    for (let i = 0; i < steps; i++) {
      v = c1 * v + c2 * gaussian(random);
      sum += v * v;
    }
    assert.ok(Math.abs(sum / steps - 0.6) < 0.02);
  });

  it("slows a driver by the gap ahead, to a standstill at the route choice's jam spacing", () => {
    const { lookAhead } = DEFAULT_CROWD;
    assert.equal(speedShare(Infinity, 1, lookAhead), 1);
    assert.equal(speedShare(lookAhead, 1, lookAhead), 1);
    assert.equal(speedShare(JAM_SPACING_METERS, 1, lookAhead), MIN_SPEED_SHARE);
    // Within half the look-ahead it is Greenshields with k = 1 / (lanes gap).
    assert.ok(Math.abs(speedShare(10, 1, lookAhead) - (1 - JAM_SPACING_METERS / 10)) < 1e-12);
    assert.ok(speedShare(10, 2, lookAhead) > speedShare(10, 1, lookAhead));
    let previous = 0;
    for (let gap = 0.5; gap <= lookAhead + 1; gap += 0.25) {
      const share = speedShare(gap, 1, lookAhead);
      assert.ok(share >= previous && share - previous < 0.1, `jump at ${gap} m`);
      previous = share;
    }
  });

  it("brakes the car behind for the car ahead, and never pushes the car ahead along", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const { edge, at } = straightStreet(router, 40);
    const sim = new CrowdSim(ground, [at(5), at(11)], seededRandom(1), () => new Set(), { ...DEFAULT_CROWD, temperature: 0 });
    onStreet(sim, edge);
    const free = router.edgeSpeed[edge];
    const along = (i: number) => sim.vx[i] * sim.hx[i] + sim.vy[i] * sim.hy[i];
    for (let s = 0; s < 16; s++) {
      sim.step();
      // The car behind counts for 0.1 against the car ahead's 1; pushed as hard as it pushes back,
      // the leader would run about 3 m/s over.
      assert.ok(along(1) <= free * 1.03, `leader at ${along(1)} m/s on a ${free} m/s street`);
    }
    assert.ok(along(0) < along(1), "the car behind is slower");
    assert.ok(along(1) > free * 0.95, "the leader, with open road ahead, is near free speed");
  });

  it("discharges a queue at about a real lane's saturation flow", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const { edge, at, along } = straightStreet(router, 500);
    const cars = 40;
    const front = cars * JAM_SPACING_METERS;
    const sim = new CrowdSim(ground, Array.from({ length: cars }, (_, k) => at(front - k * JAM_SPACING_METERS)), seededRandom(1), () => new Set(), DEFAULT_CROWD);
    onStreet(sim, edge);
    const crossed: number[] = [];
    const counted = new Set<number>();
    for (let s = 0; s < 600; s++) {
      sim.step();
      for (let i = 0; i < cars; i++) {
        if (counted.has(i) || along(sim, i) < front + 60) continue;
        counted.add(i);
        crossed.push(sim.seconds);
      }
    }
    const steady = crossed.slice(5, 35);
    const perHour = (3600 * (steady.length - 1)) / (steady[steady.length - 1] - steady[0]);
    // Saturation flow on a city lane is about 1,800 to 1,900 cars an hour.
    assert.ok(perHour > 1500 && perHour < 2200, `${Math.round(perHour)} cars an hour`);
  });

  it("keeps a car queued behind a stopped one where it is, rather than letting the noise walk it back", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const { edge, at, along } = straightStreet(router, 100);
    const sim = new CrowdSim(ground, [at(30), at(22)], seededRandom(3), () => new Set(), DEFAULT_CROWD);
    onStreet(sim, edge);
    // The car in front has nowhere to go.
    sim.stuck[0] = 1;
    for (let s = 0; s < 6 * 60 * 2; s++) sim.step();
    assert.ok(along(sim, 1) > 19 && along(sim, 1) < along(sim, 0), `the queued car is at ${along(sim, 1)} m`);
  });

  it("leaves keen households earlier than reluctant ones", () => {
    const departure = (keen: boolean, seed: number) => {
      const random = seededRandom(seed);
      let x = 0;
      for (let minute = 1; minute < 600; minute++) {
        x = stepDecision(x, keen, 300, 1, DEFAULT_DEPARTURE, random);
        if (x >= 1) return minute;
      }
      return 600;
    };
    const mean = (keen: boolean) => Array.from({ length: 200 }, (_, i) => departure(keen, i)).reduce((a, b) => a + b, 0) / 200;
    assert.ok(mean(true) < mean(false));
  });

  it("drives households to safety, and blocked streets are found and routed around", () => {
    const random = seededRandom(3);
    const households = population.filter(() => random() < 0.04);
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const start = router.nearestNode(...toXY({ lat: 34.19, lng: -118.155 }));
    const blocked = new Set<number>();
    let node = start;
    const potential = router.potential(0, new Set());
    for (let hop = 0; hop < 6; hop++) {
      const edge = router.nextEdge(node, potential, new Set());
      if (edge < 0) break;
      blocked.add(router.edgeSegment[edge]);
      node = router.edgeEnd(edge);
    }
    const sim = new CrowdSim(ground, households, seededRandom(4), () => blocked, { ...DEFAULT_CROWD, dt: 1 });
    for (let s = 0; s < 90 * 60; s++) sim.step();
    const stats = sim.stats();
    assert.ok(stats.arrived > households.length * 0.5, `${stats.arrived} of ${households.length} arrived`);
    assert.ok(sim.travelMinutes().every((m) => m > 0));
    for (let i = 0; i < sim.count; i++) assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i]));
    assert.ok(stats.waiting + stats.home + stats.moving + stats.arrived + stats.overrun === households.length);
    assert.ok(sim.state.some((state) => state === STATE.arrived));
  });

  it("spreads cars over more streets with logit route choice than when all take the fastest", () => {
    const random = seededRandom(8);
    const households = population.filter(() => random() < 0.04);
    const streetsUsed = (routeSpreadSeconds: number) => {
      const sim = new CrowdSim(ground, households, seededRandom(9), () => new Set(), { ...DEFAULT_CROWD, dt: 1, routeSpreadSeconds });
      for (let s = 0; s < 60 * 60; s++) sim.step();
      return sim.segmentEntries.filter((entries) => entries > 0).length;
    };
    const fastest = streetsUsed(0);
    const spread = streetsUsed(DEFAULT_CROWD.routeSpreadSeconds);
    assert.ok(spread > fastest * 1.1, `${spread} streets with spread, ${fastest} without`);
  });
});

describe("traffic forecast", () => {
  const random = seededRandom(5);
  const households = population.filter(() => random() < 0.05);
  const params = { ...DEFAULT_CROWD, dt: 1 };

  it("forks a simulation that carries on independently of the original", () => {
    const sim = new CrowdSim(ground, households, seededRandom(6), () => new Set(), params);
    advance(sim, 20);
    const before = sim.x.slice();
    const a = sim.fork(seededRandom(7));
    const b = sim.fork(seededRandom(7));
    advance(a, 30);
    advance(b, 30);
    assert.deepEqual(a.x, b.x);
    assert.deepEqual(sim.x, before);
    assert.equal(sim.minutes, 20);
    assert.ok(a.stats().arrived >= sim.stats().arrived);
  });

  it("summarises an ensemble's hour ahead as ranges over its members", () => {
    const ensemble = new TrafficEnsemble(ground, households, 3, 11, params);
    ensemble.advanceTo(15);
    const forecast = ensemble.forecast();
    assert.equal(forecast.members, 3);
    assert.equal(forecast.baseMinute, 15);
    assert.equal(forecast.timeline.length, FORECAST_HORIZON_MINUTES / 5 + 1);
    assert.equal(forecast.windows.length, FORECAST_WINDOWS.length);
    const arrived = forecast.timeline.map((point) => point.arrived.median ?? 0);
    assert.ok(arrived.every((value, k) => k === 0 || value >= arrived[k - 1]));
    for (const window of forecast.windows) {
      for (const row of [...window.streets, ...window.segments]) {
        assert.ok((row.lostCarMinutes.p5 ?? 0) <= (row.lostCarMinutes.median ?? 0));
        assert.ok((row.lostCarMinutes.median ?? 0) <= (row.lostCarMinutes.p95 ?? 0));
        if (row.slowdown.median !== null) assert.ok(row.slowdown.median >= 0 && row.slowdown.median <= 1);
      }
    }
    // Forecasting leaves the members at the present.
    assert.equal(ensemble.minutes, 15);
  });

  it("forecasts each direction of a street on its own, for the dispatcher's drive times", () => {
    const ensemble = new TrafficEnsemble(ground, households, 3, 11, params);
    ensemble.advanceTo(15);
    const edges = ensemble.forecast().windows.flatMap((window) => window.edges);
    assert.ok(edges.length > 0, "some street slows in the hour ahead");
    const keys = new Set(EDGES.map((edge) => edge.key));
    for (const { key, slowdown } of edges) {
      assert.ok(keys.has(key), key);
      // Every member counts, at free flow where it had no cars to measure.
      assert.equal(slowdown.n, 3);
      assert.ok(slowdown.median! >= 0.1 && slowdown.median! <= 1);
    }
    // Evacuees drive out of the zone, so a slowed direction mostly comes without its opposite.
    const window = ensemble.forecast().windows[0];
    const slowed = new Set(window.edges.map((edge) => edge.key));
    const byKey = new Map(EDGES.map((edge) => [edge.key, edge]));
    const reverseKeys = (key: string) => {
      const forward = byKey.get(key)!;
      return EDGES.filter((edge) => edge.u === forward.v && edge.v === forward.u).map((edge) => edge.key);
    };
    const withOpposite = window.edges.filter((edge) => reverseKeys(edge.key).some((back) => slowed.has(back))).length;
    assert.ok(withOpposite < window.edges.length, `${withOpposite} of ${window.edges.length} slowed both ways`);
  });

  it("gives an empty range for no values and quantiles otherwise", () => {
    assert.deepEqual(rangeOf([]), { median: null, p5: null, p95: null, n: 0 });
    assert.deepEqual(rangeOf([3, null, 1, 2]), { median: 2, p5: 1, p95: 3, n: 3 });
  });
});
