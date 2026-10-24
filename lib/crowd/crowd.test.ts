import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { gaussian, seededRandom } from "../mesh/random";
import { DEFAULT_DEPARTURE, stepDecision } from "./departure";
import { buildGround, cellIndex, toLatLng, toXY } from "./grid";
import { CrowdSim, DEFAULT_CROWD, Household, ouCoefficients, STATE } from "./langevin";
import { RoadRouter } from "./navigation";

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
});

describe("Langevin dynamics", () => {
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
});
