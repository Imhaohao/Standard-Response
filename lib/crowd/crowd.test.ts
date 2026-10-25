import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { gaussian, seededRandom } from "../mesh/random";
import { DEFAULT_DEPARTURE, departureDrift, stepDecision } from "./departure";
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

  it("closes a street from the minute the fire reaches any part of it, not only its middle", () => {
    let earlierThanMiddle = 0;
    for (const [edge, shape] of router.edgeShape.entries()) {
      for (let p = 0; p < shape.length; p += 2) {
        const cell = cellIndex(ground, shape[p], shape[p + 1]);
        if (cell >= 0) assert.ok(router.edgeFire[edge] <= ground.fireMinutes[cell], `edge ${edge} burns at ${ground.fireMinutes[cell]} before ${router.edgeFire[edge]}`);
      }
      const middle = cellIndex(ground, shape[Math.floor(shape.length / 4) * 2], shape[Math.floor(shape.length / 4) * 2 + 1]);
      if (middle >= 0 && router.edgeFire[edge] < ground.fireMinutes[middle]) earlierThanMiddle += 1;
    }
    assert.ok(earlierThanMiddle > 20, `${earlierThanMiddle} streets burn before their middle does`);
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

  it("finds the street nearest a home, in each direction it can be driven", () => {
    const slow = (edge: number) => router.edgeSpeed[edge] < 20;
    // Homes, and a point 1.5 km past the town's north-west corner, far from every street.
    const corner = { lat: Math.max(...population.map((home) => home.lat)), lng: Math.min(...population.map((home) => home.lng)) };
    const far = toLatLng(toXY(corner)[0] - 1500, toXY(corner)[1] + 1500);
    for (const home of [...population.filter((_, k) => k % 400 === 0), far]) {
      const [x, y] = toXY(home);
      const points = router.streetPoints(x, y, slow);
      assert.ok(points.length >= 1 && points.length <= 2);
      // Against every stretch of every street.
      let nearest = Infinity;
      for (const [edge, shape] of router.edgeShape.entries()) {
        if (!slow(edge)) continue;
        for (let p = 0; p + 3 < shape.length; p += 2) {
          const [ax, ay, bx, by] = shape.subarray(p, p + 4);
          const length2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length2));
          nearest = Math.min(nearest, Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y));
        }
      }
      assert.ok(Math.abs(Math.hypot(points[0].x - x, points[0].y - y) - nearest) < 1e-6);
      if (points.length === 2) {
        assert.equal(points[1].edge, router.edgeReverse[points[0].edge]);
        assert.ok(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) < 1);
        assert.ok(Math.abs(points[0].along + points[1].along - router.edgeLength[points[0].edge]) < 1);
      }
    }
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
    assert.equal(speedShare(Infinity, lookAhead), 1);
    assert.equal(speedShare(lookAhead, lookAhead), 1);
    assert.equal(speedShare(JAM_SPACING_METERS, lookAhead), MIN_SPEED_SHARE);
    // Within half the look-ahead it is Greenshields with k = 1 / gap in the lane.
    assert.ok(Math.abs(speedShare(10, lookAhead) - (1 - JAM_SPACING_METERS / 10)) < 1e-12);
    let previous = 0;
    for (let gap = 0.5; gap <= lookAhead + 1; gap += 0.25) {
      const share = speedShare(gap, lookAhead);
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

  it("keeps a safe time gap, so a freeway lane's queue discharges no faster than a real one", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const stretch = (k: number) => Math.hypot(router.edgeShape[k][2] - router.edgeShape[k][0], router.edgeShape[k][3] - router.edgeShape[k][1]);
    const edge = EDGES.findIndex((e, k) => stretch(k) > 240 && router.edgeLanes[k] === 2 && router.edgeSpeed[k] > 25 && router.edgeFire[k] > 200 && !router.safe[e.v]);
    assert.ok(edge >= 0);
    const [ax, ay, bx, by] = router.edgeShape[edge];
    const length = stretch(edge);
    const { laneWidth } = DEFAULT_CROWD;
    // Each lane's middle, metres right of the line the street is drawn on.
    const shift = (lane: number) => (router.edgeTwoWay[edge] ? laneWidth / 2 + lane * laneWidth : (lane - 0.5) * laneWidth);
    const rows = 18;
    const front = rows * JAM_SPACING_METERS + 10;
    const homes = Array.from({ length: 2 * rows }, (_, k): Household => {
      const m = front - Math.floor(k / 2) * JAM_SPACING_METERS;
      const right = shift(k % 2);
      return { ...toLatLng(ax + ((bx - ax) * m + (by - ay) * right) / length, ay + ((by - ay) * m - (bx - ax) * right) / length), peopleCount: 1, canLeave: "yes", hasCar: true };
    });
    const sim = new CrowdSim(ground, homes, seededRandom(1), () => new Set(), DEFAULT_CROWD);
    onStreet(sim, edge);
    for (let i = 0; i < sim.count; i++) sim.lane[i] = i % 2;
    const along = (i: number) => ((sim.x[i] - ax) * (bx - ax) + (sim.y[i] - ay) * (by - ay)) / length;
    const crossed: number[] = [];
    const counted = new Set<number>();
    for (let s = 0; s < 400 * 2; s++) {
      sim.step();
      for (let i = 0; i < sim.count; i++) {
        if (counted.has(i) || along(i) < front + 60) continue;
        counted.add(i);
        crossed.push(sim.seconds);
      }
    }
    const steady = crossed.slice(5, 30);
    const perLaneHour = (3600 * (steady.length - 1)) / (steady[steady.length - 1] - steady[0]) / 2;
    // Greenshields alone let it go 3,600 cars an hour a lane, 1 s apart at 29 m/s.
    assert.ok(perLaneHour > 1600 && perLaneHour < 2400, `${Math.round(perLaneHour)} cars an hour a lane at ${router.edgeSpeed[edge].toFixed(0)} m/s`);
  });

  // A one-lane street and a street that crosses its first stretch with no intersection between
  // them, on a bridge: the bridge street's stretch that crosses, and the crossing as metres along
  // the first street and its point.
  const findBridge = (router: RoadRouter) => {
    const usable = (k: number) => router.edgeLanes[k] === 1 && router.edgeFire[k] > 200 && !router.safe[EDGES[k].v] && !router.safe[EDGES[k].u];
    const shared = (a: number, b: number) => [EDGES[a].u, EDGES[a].v].some((n) => n === EDGES[b].u || n === EDGES[b].v);
    const within = (value: number, low: number, high: number) => value > low && value < high;
    const crossing = (a: number, b: number, q: number): [number, number, number] | null => {
      const [ax, ay, bx, by] = router.edgeShape[a];
      const shape = router.edgeShape[b];
      const [cx, cy, dx, dy] = shape.subarray(2 * q, 2 * q + 4);
      const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(d) < 1e-6) return null;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
      const length = Math.hypot(bx - ax, by - ay);
      return within(t * length, 50, length - 15) && within(u, 0, 1) ? [t * length, ax + (bx - ax) * t, ay + (by - ay) * t] : null;
    };
    for (let under = 0; under < EDGES.length; under++) {
      if (!usable(under)) continue;
      for (let bridge = 0; bridge < EDGES.length; bridge++) {
        if (bridge === under || shared(under, bridge)) continue;
        for (let stretch = 0; stretch + 1 < router.edgeShape[bridge].length / 2; stretch++) {
          const at = crossing(under, bridge, stretch);
          if (at) return { under, bridge, stretch, at };
        }
      }
    }
    return null;
  };

  it("lets a car drive under a bridge whatever is stopped on it", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const found = findBridge(router);
    assert.ok(found, "a bridge");
    const { under, bridge, stretch, at } = found;
    const [metres, cx, cy] = at;
    const [ax, ay] = router.edgeShape[under];
    const sim = new CrowdSim(
      ground,
      [
        { ...toLatLng(ax, ay), peopleCount: 1, canLeave: "yes", hasCar: true },
        { ...toLatLng(cx, cy), peopleCount: 1, canLeave: "yes", hasCar: true },
      ],
      seededRandom(1),
      () => new Set(),
      { ...DEFAULT_CROWD, temperature: 0, lateralTemperature: 0 },
    );
    onStreet(sim, under);
    // A car standing on the bridge right over the street, in its middle lane.
    sim.edge[1] = bridge;
    sim.point[1] = stretch + 1;
    sim.lane[1] = Math.floor(router.edgeLanes[bridge] / 2);
    sim.stuck[1] = 1;
    let slowest = Infinity;
    for (let s = 0; s < 2 * 60 * 2 && sim.edge[0] === under; s++) {
      sim.step();
      const travelled = Math.hypot(sim.x[0] - ax, sim.y[0] - ay);
      if (travelled > metres - 15 && travelled < metres + 10) slowest = Math.min(slowest, sim.routeSpeed(0));
    }
    assert.ok(slowest > 0.95 * router.edgeSpeed[under], `slowed to ${slowest.toFixed(1)} m/s under the bridge, ${router.edgeSpeed[under].toFixed(1)} free`);
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

  it("counts a route point it drove past as reached, so a fast car doesn't turn back for it", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const stretch = (k: number, p: number) => {
      const shape = router.edgeShape[k];
      return Math.hypot(shape[2 * p + 2] - shape[2 * p], shape[2 * p + 3] - shape[2 * p + 1]);
    };
    const edge = EDGES.findIndex((e, k) => router.edgeShape[k].length >= 6 && stretch(k, 0) > 30 && stretch(k, 1) > 30 && router.edgeFire[k] > 200 && !router.safe[e.v]);
    assert.ok(edge >= 0);
    const [ax, ay, bx, by] = router.edgeShape[edge];
    const length = stretch(edge, 0);
    // 12 m past the end of the first stretch, outside the reach circle, as one 1 s step at 50 km/h leaves it.
    const past = toLatLng(ax + ((bx - ax) * (length + 12)) / length, ay + ((by - ay) * (length + 12)) / length);
    const sim = new CrowdSim(ground, [{ ...past, peopleCount: 1, canLeave: "yes", hasCar: true }], seededRandom(1), () => new Set(), { ...DEFAULT_CROWD, dt: 1, temperature: 0 });
    onStreet(sim, edge);
    sim.step();
    assert.equal(sim.point[0], 2, "steering for the next point on the street");
  });

  // A straight one-lane street ending in a turn onto a street nearly at right angles, and the car
  // that drives it from its start with no noise, planning that turn or none.
  const intoTurn = (planTurn: boolean) => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const direction = (shape: Float64Array, from: number) => {
      const dx = shape[from + 2] - shape[from];
      const dy = shape[from + 3] - shape[from + 1];
      const length = Math.hypot(dx, dy);
      return [dx / length, dy / length, length];
    };
    let edge = -1;
    let turn = -1;
    for (let e = 0; e < EDGES.length && turn < 0; e++) {
      const shape = router.edgeShape[e];
      if (shape.length !== 4 || router.edgeLanes[e] !== 1 || router.edgeSpeed[e] < 11 || router.edgeFire[e] < 200 || router.safe[EDGES[e].v]) continue;
      const [ux, uy, length] = direction(shape, 0);
      if (length < 150) continue;
      edge = e;
      turn = EDGES.findIndex((next, k) => next.u === EDGES[e].v && next.v !== EDGES[e].u && Math.abs(ux * direction(router.edgeShape[k], 0)[0] + uy * direction(router.edgeShape[k], 0)[1]) < 0.1);
    }
    assert.ok(turn >= 0);
    const [ax, ay] = router.edgeShape[edge];
    const sim = new CrowdSim(ground, [{ ...toLatLng(ax, ay), peopleCount: 1, canLeave: "yes", hasCar: true }], seededRandom(1), () => new Set(), {
      ...DEFAULT_CROWD,
      temperature: 0,
      lateralTemperature: 0,
    });
    onStreet(sim, edge);
    sim.next[0] = planTurn ? turn : -1;
    // Speeds on the street, up to the last step before the car turns off it.
    const speeds: number[] = [];
    while (sim.seconds < 120) {
      sim.step();
      if (sim.edge[0] !== edge) break;
      speeds.push(sim.routeSpeed(0));
    }
    return { sim, speeds, free: router.edgeSpeed[edge] };
  };

  it("slows for a turn ahead in time to take it at about 20 km/h, and only when it turns", () => {
    const turning = intoTurn(true);
    const straight = intoTurn(false);
    // sqrt(3 m/s² x 15 m / (2 sin 45°)) = 5.6 m/s for a right-angle turn.
    const atTurn = turning.speeds[turning.speeds.length - 1];
    assert.ok(atTurn > 4 && atTurn < 7.5, `${atTurn.toFixed(1)} m/s into the turn`);
    assert.ok(Math.max(...turning.speeds) > turning.free * 0.9, "up to speed before braking");
    assert.ok(straight.speeds[straight.speeds.length - 1] > straight.free * 0.9, "no braking with no turn");
  });

  it("counts none of a lone car's slowing for corners as time lost to crowding", () => {
    const { sim } = intoTurn(true);
    for (let s = 0; s < 240; s++) sim.step();
    const samples = sim.segmentSpeedSamples.reduce((a, b) => a + b, 0);
    const lost = sim.segmentLostSeconds.reduce((a, b) => a + b, 0);
    assert.ok(samples >= 5, `${samples} samples`);
    assert.ok(lost < 0.05 * 30 * samples, `${lost.toFixed(0)} s lost of ${30 * samples} s driven`);
  });

  it("queues in single file in its lane, not two abreast", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const { edge, at, along } = straightStreet(router, 200);
    const [ax, ay, bx, by] = router.edgeShape[edge];
    const length = Math.hypot(bx - ax, by - ay);
    const right = (sim: CrowdSim, i: number) => ((sim.x[i] - ax) * (by - ay) - (sim.y[i] - ay) * (bx - ax)) / length;
    // Twenty cars two abreast, 2.5 m apart across the street and 6 m apart along it, room for one
    // file, behind a car that can't move.
    const homes = Array.from({ length: 21 }, (_, k) => {
      const home = at(150 - 6 * k);
      const [x, y] = toXY(home);
      const side = k === 0 ? 0 : k % 2 ? 1.25 : -1.25;
      return { ...home, ...toLatLng(x + ((by - ay) / length) * side, y - ((bx - ax) / length) * side) };
    });
    const sim = new CrowdSim(ground, homes, seededRandom(2), () => new Set(), DEFAULT_CROWD);
    onStreet(sim, edge);
    sim.stuck[0] = 1;
    for (let s = 0; s < 3 * 60 * 2; s++) sim.step();
    const sides = Array.from({ length: sim.count }, (_, i) => right(sim, i));
    assert.ok(Math.max(...sides) - Math.min(...sides) < 1.5, `spread ${(Math.max(...sides) - Math.min(...sides)).toFixed(1)} m across the lane`);
    const order = Array.from({ length: sim.count }, (_, i) => along(sim, i)).sort((a, b) => b - a);
    for (let k = 1; k < order.length; k++) assert.ok(order[k - 1] - order[k] > 4, `cars ${(order[k - 1] - order[k]).toFixed(1)} m apart in the queue`);
  });

  it("drives right of the centreline, so cars going opposite ways on a two-way street pass at speed", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const reverseOf = (e: number) => EDGES.findIndex((other) => other.u === EDGES[e].v && other.v === EDGES[e].u);
    // A straight two-way street, one lane each way.
    const edge = EDGES.findIndex(
      (e, k) => router.edgeShape[k].length === 4 && e.meters > 200 && router.edgeTwoWay[k] && router.edgeLanes[k] === 1 && router.edgeFire[k] > 200 && !router.safe[e.v] && !router.safe[e.u],
    );
    const back = reverseOf(edge);
    assert.ok(edge >= 0 && back >= 0);
    const [ax, ay, bx, by] = router.edgeShape[edge];
    const length = Math.hypot(bx - ax, by - ay);
    const at = (m: number): Household => ({ ...toLatLng(ax + ((bx - ax) * m) / length, ay + ((by - ay) * m) / length), peopleCount: 1, canLeave: "yes", hasCar: true });
    const sim = new CrowdSim(ground, [at(20), at(length - 20)], seededRandom(1), () => new Set(), { ...DEFAULT_CROWD, temperature: 0, lateralTemperature: 0 });
    onStreet(sim, edge);
    sim.edge[1] = back;
    sim.goal[1] = router.edgeStart(back);
    sim.point[1] = router.edgeShape[back].length / 2 - 1;
    const free = router.edgeSpeed[edge];
    for (const [i, sign] of [[0, 1], [1, -1]]) {
      sim.vx[i] = (sign * free * (bx - ax)) / length;
      sim.vy[i] = (sign * free * (by - ay)) / length;
    }
    let slowest = Infinity;
    for (let s = 0; s < ((length - 40) / free) * 2; s++) {
      sim.step();
      slowest = Math.min(slowest, sim.routeSpeed(0), sim.routeSpeed(1));
    }
    assert.ok(slowest > 0.8 * free, `slowed to ${slowest.toFixed(1)} of ${free.toFixed(1)} m/s passing`);
  });

  it("leaves at drift-diffusion's exact mean first passage, 1 / mu, not later", () => {
    // Far from the fire the drift is constant, and the first passage to 1 from 0 takes 1 / mu on
    // average. Steps are half a minute, so a departure is counted up to half a minute late.
    const step = 0.5;
    for (const [keen, runs, tolerance] of [[true, 20_000, 0.5], [false, 10_000, 3]] as const) {
      const random = seededRandom(5);
      let total = 0;
      for (let run = 0; run < runs; run++) {
        let x = 0;
        let minutes = 0;
        for (; x < 1; minutes += step) x = stepDecision(x, keen, 1e6, step, DEFAULT_DEPARTURE, random);
        total += minutes;
      }
      const exact = 1 / departureDrift(keen, 1e6, DEFAULT_DEPARTURE) + step / 2;
      assert.ok(Math.abs(total / runs - exact) < tolerance, `${(total / runs).toFixed(1)} min against ${exact.toFixed(1)}`);
    }
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

  it("pulls out onto the street in front of the house, not the nearest intersection", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    const front = (home: Household) => router.streetPoints(...toXY(home), (edge) => router.edgeSpeed[edge] < 20);
    // Homes within 100 m of a street (some synthetic homes lie past the edge of the road graph).
    const homes = population.filter((home, k) => {
      const [x, y] = toXY(home);
      return k % 300 === 0 && home.canLeave === "yes" && home.hasCar && Math.hypot(front(home)[0].x - x, front(home)[0].y - y) < 100;
    });
    const sim = new CrowdSim(ground, homes, seededRandom(1), () => new Set(), DEFAULT_CROWD);
    const fronts = homes.map((home) => front(home).map((point) => point.edge));
    for (let i = 0; i < sim.count; i++) {
      sim.state[i] = STATE.moving;
      sim.onDriveway[i] = 1;
    }
    const joined = new Int32Array(sim.count).fill(-1);
    for (let s = 0; s < 3 * 60 * 2 && joined.includes(-1); s++) {
      sim.step();
      for (let i = 0; i < sim.count; i++) if (joined[i] < 0 && sim.edge[i] >= 0) joined[i] = sim.edge[i];
    }
    const inFront = [...joined].filter((edge, i) => fronts[i].includes(edge)).length;
    assert.ok(inFront >= sim.count - 1, `${inFront} of ${sim.count} took the street in front`);
  });

  it("with no route to safety, drives away from the fire to wait where it reaches last", () => {
    const router = new RoadRouter(ground, DEFAULT_CROWD.safeLat);
    // The driver believes every street into safety is blocked.
    const cut = new Set(EDGES.flatMap((e, k) => (router.safe[e.v] ? [router.edgeSegment[k]] : [])));
    const trapped = router.potential(0, cut);
    const start = router.nodeFire.findIndex((fire, n) => fire > 30 && fire < 300 && !router.safe[n] && !Number.isFinite(trapped.phi[n]) && router.refuge(n, 0, cut) !== n);
    assert.ok(start >= 0);
    const home = { ...toLatLng(router.nodeX[start], router.nodeY[start]), peopleCount: 1, canLeave: "yes", hasCar: true };
    const sim = new CrowdSim(ground, [home], seededRandom(1), () => new Set(), DEFAULT_CROWD);
    sim.setKnown(0, cut);
    sim.state[0] = STATE.moving;
    for (let s = 0; s < 15 * 60 * 2; s++) sim.step();
    const at = router.nearestNode(sim.x[0], sim.y[0]);
    assert.equal(sim.state[0], STATE.moving);
    assert.equal(sim.stuck[0], 1, "waiting at the refuge");
    assert.ok(router.nodeFire[at] > router.nodeFire[start], `fire at ${router.nodeFire[at]} min where it waits, ${router.nodeFire[start]} where it started`);
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
    // Summed over three samples of households: from one sample to the next the gain runs from 7% to 25%.
    let fastest = 0;
    let spread = 0;
    for (const seed of [8, 9, 10]) {
      const random = seededRandom(seed);
      const households = population.filter(() => random() < 0.04);
      const streetsUsed = (routeSpreadSeconds: number) => {
        const sim = new CrowdSim(ground, households, seededRandom(seed + 1), () => new Set(), { ...DEFAULT_CROWD, dt: 1, routeSpreadSeconds });
        for (let s = 0; s < 60 * 60; s++) sim.step();
        return sim.segmentEntries.filter((entries) => entries > 0).length;
      };
      fastest += streetsUsed(0);
      spread += streetsUsed(DEFAULT_CROWD.routeSpreadSeconds);
    }
    assert.ok(spread > fastest * 1.05, `${spread} streets with spread, ${fastest} without`);
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
