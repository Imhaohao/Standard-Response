import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { cityById } from "../../../cities";
import { AREA_KIND, createProjection, type InkMapData, type Point } from "../../data";
import { arrivalMinutesAt, buildFireField, scenarioFronts, type ScenarioGeoJson } from "../../fire-field";
import type { Scenario } from "../../scenario";
import { impactAt } from "../arrival";
import { firstUnderWater, waterIndex } from "./impact";
import { crestDelay, datumShift, depthAt, groundAt, pourReach, seaSurface, surfaceAt, waterModel, waveShape, type TsunamiWave, type WaveTrain } from "./model";
import { cellCentre, shoreFor, shoreGrid } from "./shore";
import { standingCells, standingOutline } from "./paper-grid";
import { breachAxis, waterField } from "./source";

const ORIGIN = { lat: 29.966, lng: -90.009 };
const { toLatLng } = createProjection(ORIGIN);

type Box = [number, number, number, number];

type FakeMap = { ground?: (x: number, y: number) => number; buildings?: Point[]; roads?: Point[][]; ponds?: Point[][] };

const lowWestHighEast = (x: number) => (x < 0 ? -1 : 3);

// A square map 1 km across: ground at -1 m west of x = 0 and +3 m east of it, unless `ground` says otherwise.
function fakeMap({ ground = lowWestHighEast, buildings = [], roads = [], ponds = [] }: FakeMap = {}): InkMapData {
  const cols = 101;
  const cell = 10;
  const x0 = -500;
  const raw = Array.from({ length: cols * cols }, (_, i) => ground(x0 + (i % cols) * cell, x0 + Math.floor(i / cols) * cell));
  const base = Math.min(...raw);
  const box = { x0: -500, y0: -500, x1: 500, y1: 500 };
  return {
    origin: ORIGIN,
    detail: box,
    extent: box,
    terrain: { cols, rows: cols, cell, x0, y0: x0, heights: Float32Array.from(raw, (h) => h - base), base },
    buildings: buildings.map((center, id) => ({ id, kind: 0, roof: 1, walls: 3, rise: 1.5, center, ring: [[center[0] - 5, center[1] - 5], [center[0] + 5, center[1] - 5], [center[0] + 5, center[1] + 5], [center[0] - 5, center[1] + 5]] })),
    roads: roads.map((path) => ({ roadClass: 4, name: "Test St", tunnel: false, path })),
    areas: ponds.map((ring) => ({ kind: AREA_KIND.water, ring })),
    trees: new Float32Array(0),
    graph: { nodes: [], edges: roads.map((shape, i) => ({ u: 0, v: 1, seconds: 30, key: `edge-${i}`, shape })) },
  };
}

const rectangle = ([x0, y0, x1, y1]: Box) =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map((point) => {
    const { lat, lng } = toLatLng(point as Point);
    return [lng, lat];
  });

const frontsGeoJson = (fronts: { minutes: number; box: Box }[]): ScenarioGeoJson => ({
  features: fronts.map(({ minutes, box }) => ({ properties: { minutesAfterWarning: minutes }, geometry: { type: "Polygon", coordinates: [rectangle(box)] } })),
});

// Water reaches the low west first, then the whole low half and a 20 m sliver of the high ground; the
// level rises from -1.5 m to 2 m over the hour.
function floodScenario(levelOffset = 0, breaches: { at: Point; opensAtMinutes: number; widthMeters: number }[] = [], gauge?: { at: Point; meters: number }): Scenario {
  return {
    version: 2,
    city: "test",
    kind: "flood",
    label: "Test flood",
    basis: "Synthetic",
    sources: [],
    clock: { warningAt: "2005-08-29T00:00:00-05:00", minutesShown: 120 },
    fronts: frontsGeoJson([
      { minutes: 10, box: [-400, -300, -200, 300] },
      { minutes: 30, box: [-400, -300, 20, 300] },
    ]),
    series: {
      water: {
        datum: "test",
        level: [
          { minutes: 0, meters: -1.5 + levelOffset },
          { minutes: 60, meters: 2 + levelOffset },
        ],
        gauges: gauge ? [{ id: "canal", name: "Canal", at: toLatLng(gauge.at), level: [{ minutes: 0, meters: gauge.meters }] }] : undefined,
      },
      breaches: breaches.map((breach) => ({ ...breach, at: toLatLng(breach.at) })),
    },
  };
}

function floodWorld(map: InkMapData, scenario = floodScenario()) {
  const field = buildFireField(scenarioFronts(scenario.fronts, createProjection(ORIGIN).toLocal));
  return { map, field, model: waterModel(scenario, map, field, "flood") };
}

test("depth is the water level minus the ground, and dry until the water reaches the point", () => {
  const { map, field, model } = floodWorld(fakeMap());
  const point: Point = [-300, 0];
  const ground = groundAt(map, point);
  assert.equal(ground, -1);
  assert.equal(model.shift, 0);
  assert.equal(depthAt(model, ground, 6, point, 5), -Infinity);
  assert.ok(Math.abs(depthAt(model, ground, 6, point, 30) - (-1.5 + 1.75 + 1)) < 1e-9);
  const arrival = field.minutes[Math.floor(field.minutes.length / 2)];
  assert.ok(Number.isFinite(arrival));
});

test("impact reports a building once water stands half a metre over its ground, never on dry high ground", () => {
  const buildings: Point[] = [
    [-300, 0],
    [10, 0],
    [-100, 0],
    [300, 0],
    [-470, 0],
  ];
  const { map, field, model } = floodWorld(fakeMap({ buildings }));
  const index = waterIndex(model, map, field);
  assert.equal(index.buildings[0], 18);
  assert.equal(index.buildings[1], Infinity);
  assert.ok(index.buildings[2] > 18 && index.buildings[2] < 21, `low building behind the second front floods as it arrives, got ${index.buildings[2]}`);
  assert.equal(index.buildings[3], Infinity);
  assert.equal(index.buildings[4], Infinity, "low ground outside every front stays dry long after the last one");
  assert.deepEqual(impactAt(index, 17.5).buildings, []);
  assert.deepEqual(impactAt(index, 18).buildings, [0]);
  assert.deepEqual(impactAt(index, 25).buildings, [0, 2]);
});

test("impact closes a road and its graph edge when any stretch of it is under 30 cm of water", () => {
  const roads: Point[][] = [
    [
      [-350, -100],
      [200, -100],
    ],
    [
      [100, 200],
      [400, 200],
    ],
  ];
  const { map, field, model } = floodWorld(fakeMap({ roads }));
  const index = waterIndex(model, map, field);
  assert.equal(index.roads[0], 14);
  assert.equal(index.roads[1], Infinity);
  assert.deepEqual(impactAt(index, 13).roads, []);
  assert.deepEqual(impactAt(index, 14), { buildings: [], roads: [0], edges: ["edge-0"] });
});

test("a scenario level below the ground its fronts reach is lifted onto it", () => {
  const consistent = floodWorld(fakeMap());
  const sunk = floodWorld(fakeMap(), floodScenario(-5));
  assert.equal(consistent.model.shift, 0);
  assert.ok(Math.abs(sunk.model.shift - 2.2) < 1e-6, `the peak, 3 m below the low ground, is lifted 20 cm over it: ${sunk.model.shift}`);
  assert.equal(datumShift(sunk.model, sunk.map, null), 0);
});

test("through an open breach the surface slopes from the canal's level down to the basin's", () => {
  const breach = { at: [-400, 0] as Point, opensAtMinutes: 20, widthMeters: 50 };
  const { model } = floodWorld(fakeMap(), floodScenario(0, [breach], { at: [-450, 0], meters: 3 }));
  const reach = pourReach({ at: breach.at, opensAt: 20, width: 50 });
  const basin = -1.5 + (3.5 * 25) / 60;
  assert.equal(surfaceAt(model, [-400, 0], 25), 3);
  assert.ok(surfaceAt(model, [-400 + reach / 2, 0], 25) < 3 && surfaceAt(model, [-400 + reach / 2, 0], 25) > basin);
  assert.ok(Math.abs(surfaceAt(model, [-400 + reach + 10, 0], 25) - basin) < 1e-9);
  assert.ok(Math.abs(surfaceAt(model, [-400, 0], 15) - (-1.5 + (3.5 * 15) / 60)) < 1e-9);
});

test("inside the first front the water spreads out from the breach, not in from the front's edge", () => {
  const breach = { at: [-400, 0] as Point, opensAtMinutes: 5, widthMeters: 50 };
  const { map, field, model } = floodWorld(fakeMap(), floodScenario(0, [breach], { at: [-450, 0], meters: 3 }));
  const spread = waterField(field, model, shoreFor(map, "flood"));
  const atBreach = arrivalMinutesAt(spread, [-395, 0])!;
  const farCorner = arrivalMinutesAt(spread, [-205, 295])!;
  assert.ok(atBreach < 5.3, `the gap floods as it opens: ${atBreach}`);
  assert.ok(farCorner > 9.5 && farCorner <= 10, `the far corner floods with the first front: ${farCorner}`);
  assert.ok(arrivalMinutesAt(field, [-395, 0])! > 9, "the fire's rule had the edge by the breach flood last");
  assert.equal(arrivalMinutesAt(spread, [-100, 0]), arrivalMinutesAt(field, [-100, 0]), "between later fronts nothing changes");
});

test("a breach's jet is aimed where its water went, into the ward and away from the canal", () => {
  const breach = { at: [-400, 0] as Point, opensAtMinutes: 5, widthMeters: 50 };
  const { map, field, model } = floodWorld(fakeMap(), floodScenario(0, [breach], { at: [-450, 0], meters: 3 }));
  const spread = waterField(field, model, shoreFor(map, "flood"));
  const [x, y] = breachAxis(spread, model.still!.breaches[0]);
  assert.ok(x > 0.9 && Math.abs(y) < 0.4, `axis ${x}, ${y}`);
  assert.deepEqual(breachAxis(spread, { at: [-400, 0], opensAt: 500, width: 50 }), [0, 0], "a breach that opens after the water has spread has no jet");
});

const bore: TsunamiWave = { arrival: 100, runup: 6, period: 20, drawdown: 2 };

test("a tsunami crest draws the sea back first, stands at its run-up, then drains away", () => {
  assert.equal(waveShape(-30, bore), 0);
  assert.ok(waveShape(-5, bore) < -1.5, `drawn back ${waveShape(-5, bore)}`);
  assert.equal(waveShape(1, bore), 6);
  assert.ok(waveShape(5, bore) < 6 && waveShape(5, bore) > 0);
  assert.ok(Math.abs(waveShape(40, bore)) < 1e-9);
});

test("a crest crosses the sea, reaches each stretch of shore in turn and runs inland from it", () => {
  // The shore runs east to west along y = 0, with the land to the south; the crest comes from the north.
  const inland = ([, y]: Point) => Math.max(0, -y);
  const train: WaveTrain = { travel: [0, -1], reference: [0, 0], celerity: { sea: 600, land: 240 }, waves: [bore], inland };
  assert.equal(crestDelay(train, [0, 600]), -1);
  assert.equal(crestDelay(train, [0, -480]), 2);
  assert.equal(crestDelay(train, [3000, 0]), 0, "the whole shore square to the crest is reached at once");
  assert.equal(seaSurface(train, [0, 600], 100), 6);
  assert.ok(seaSurface(train, [0, -480], 100) < 0, "the land behind the reference is still drawn back when the crest reaches the bayfront");
  assert.equal(seaSurface(train, [0, -480], 102.5), 6);
});

test("the sea fills from the edge over low ground but not into a basin behind higher ground", () => {
  const ground = (x: number, y: number) => {
    if (x < -300) return -2;
    if (x >= 0 && x <= 100 && Math.abs(y) < 200) return -1;
    return 2;
  };
  const pond: Point[] = [
    [200, 200],
    [300, 200],
    [300, 300],
    [200, 300],
  ];
  const map = fakeMap({ ground, ponds: [pond] });
  const at = (grid: ReturnType<typeof shoreGrid>, [x, y]: Point) => {
    const col = Math.floor(((x - grid.region.x0) / (grid.region.x1 - grid.region.x0)) * grid.width);
    const row = Math.floor(((y - grid.region.y0) / (grid.region.y1 - grid.region.y0)) * grid.height);
    return row * grid.width + col;
  };
  const coast = shoreGrid(map, { sea: true });
  assert.equal(coast.water[at(coast, [-450, 0])], 1);
  assert.equal(coast.water[at(coast, [50, 0])], 0);
  assert.equal(coast.water[at(coast, [250, 250])], 1);
  assert.ok(coast.distance[at(coast, [-450, 0])] > 100);
  assert.ok(coast.distance[at(coast, [-200, 0])] < -50);
  assert.ok(coast.onshore[0] > 0.9, `onshore points east, from the sea to the land: ${coast.onshore}`);
  const levee = shoreGrid(map, { sea: false });
  assert.equal(levee.water[at(levee, [-450, 0])], 0);
  assert.equal(levee.water[at(levee, [250, 250])], 1);
});

test("the flat map traces a sea that runs off the edge of the terrain without failing", () => {
  const map = fakeMap({ ground: (x: number) => (x < -300 ? -2 : 2) });
  const cells = standingCells(shoreGrid(map, { sea: true }));
  const rings = standingOutline(cells, 0);
  assert.ok(rings.length > 0);
  assert.ok(rings.every((ring) => ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))));
});

const scenarioFile = (city: string) => `public/scenarios/${city}.json`;
const readScenario = (city: string) => JSON.parse(readFileSync(scenarioFile(city), "utf8")) as Scenario;

function modelOnFlatMap(city: string, kind: "flood" | "surge" | "tsunami") {
  const scenario = readScenario(city);
  const origin = cityById(city).origin;
  const map = { ...fakeMap({ ground: () => -3 }), origin };
  const field = buildFireField(scenarioFronts(scenario.fronts, createProjection(origin).toLocal), 96);
  return { scenario, model: waterModel(scenario, map, field, kind), map, field };
}

test("the Lower Ninth's breaches open on the scenario's clock and pour from the Industrial Canal", { skip: !existsSync(scenarioFile("lower-ninth")) }, () => {
  const { model, map, field } = modelOnFlatMap("lower-ninth", "flood");
  const [north, south] = model.still!.breaches;
  assert.equal(model.shift, 0);
  assert.equal(north.opensAt, 1050);
  assert.equal(south.opensAt, 1230);
  assert.ok(surfaceAt(model, north.at, 1100) > surfaceAt(model, north.at, 1040), "the canal's level reaches the gap once it opens");
  assert.ok(model.span.from < 1080 && model.span.to >= 1600);
  const inside = field.minutes.findIndex((minutes) => minutes <= field.fronts[0].minutes);
  const reached = cellCentre(field, inside);
  assert.ok(firstUnderWater(model, map, field, reached, 0.5, [1100, 1200]) <= 1100);
});

test("Hilo's waves come from the northeast and the bore is the third", { skip: !existsSync(scenarioFile("hilo")) }, () => {
  const { model } = modelOnFlatMap("hilo", "tsunami");
  const train = model.train!;
  assert.equal(train.waves.length, 3);
  assert.ok(train.travel[0] < -0.7 && train.travel[1] < -0.7, `travel ${train.travel}`);
  assert.equal(Math.max(...train.waves.map((wave) => wave.runup)), train.waves[2].runup);
  assert.ok(seaSurface(train, train.reference, train.waves[2].arrival - 4) < 0, "the sea draws back before the bore");
});

test("Fort Myers Beach's surge peaks near four metres with its wind", { skip: !existsSync(scenarioFile("fort-myers-beach")) }, () => {
  const { model } = modelOnFlatMap("fort-myers-beach", "surge");
  const peak = Math.max(...model.still!.basin.map((sample) => sample.meters));
  assert.ok(peak > 3.5 && peak < 4.5, `peak ${peak}`);
  assert.ok(model.still!.wind.length > 10);
});
