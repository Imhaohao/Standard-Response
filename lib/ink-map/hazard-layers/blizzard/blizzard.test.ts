import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cityById } from "../../../cities";
import type { Building, InkMapData, Point, Road } from "../../data";
import type { Scenario } from "../../scenario";
import { footprintMask, maskShape } from "./footprints";
import { geometryBytes, GpuBudget, MOST_GPU_BYTES } from "./gpu-budget";
import { streetRibbons } from "./streets";
import { buildNetwork, closureBarriers, closureRules, closureStateKey, impactAt, roadWindows, streetName } from "./roads";
import { blizzardWeather, type BlizzardSeriesWithPower, daylightFromElevation, sunElevationDegrees, whiteoutFromVisibility } from "./weather";

const buffalo = JSON.parse(readFileSync(new URL("../../../../public/scenarios/buffalo.json", import.meta.url), "utf8")) as Scenario<"blizzard">;
const BUFFALO = cityById("buffalo").origin;

describe("blizzard weather", () => {
  it("reads visibility as a whiteout on a log scale", () => {
    assert.equal(whiteoutFromVisibility(0), 1);
    assert.ok(whiteoutFromVisibility(10_000) < 0.01);
    assert.ok(whiteoutFromVisibility(100) > whiteoutFromVisibility(1000));
  });

  it("puts the winter sun about 24 degrees up at noon in Buffalo and well below at midnight", () => {
    const noon = sunElevationDegrees(Date.parse("2022-12-23T12:15:00-05:00"), BUFFALO);
    assert.ok(noon > 22 && noon < 25, `noon elevation ${noon}`);
    assert.ok(sunElevationDegrees(Date.parse("2022-12-24T00:00:00-05:00"), BUFFALO) < -50);
    assert.equal(daylightFromElevation(10), 1);
    assert.equal(daylightFromElevation(-10), 0);
  });

  it("follows the storm through the Buffalo scenario", () => {
    const morning = blizzardWeather(buffalo, 0, BUFFALO);
    const evening = blizzardWeather(buffalo, 700, BUFFALO);
    const clearing = blizzardWeather(buffalo, 2600, BUFFALO);
    assert.equal(morning.daylight, 1);
    assert.equal(evening.daylight, 0);
    assert.ok(morning.whiteout > 0.6, `whiteout ${morning.whiteout}`);
    assert.ok(clearing.whiteout < 0.15, `whiteout ${clearing.whiteout}`);
    assert.ok(evening.depthMeters > morning.depthMeters && clearing.depthMeters > evening.depthMeters);
    assert.ok(morning.snowfall > 0.7 && clearing.snowfall < morning.snowfall);
    // A south-west wind blows toward the north-east.
    assert.ok(morning.windToward[0] > 0 && morning.windToward[1] > 0);
    assert.ok(evening.powerOutShare > morning.powerOutShare && evening.powerOutShare < 0.5);
  });

  it("darkens homes only when the scenario says how many lost power", () => {
    const series: BlizzardSeriesWithPower = { ...buffalo.series, power: [{ minutes: 0, shareOut: 0 }, { minutes: 600, shareOut: 0.2 }] };
    const withPower: Scenario = { ...buffalo, series };
    assert.ok(Math.abs(blizzardWeather(withPower, 300, BUFFALO).powerOutShare - 0.1) < 1e-9);
    const unlit: BlizzardSeriesWithPower = { ...series, power: undefined };
    const withoutPower: Scenario = { ...buffalo, series: unlit };
    assert.equal(blizzardWeather(withoutPower, 300, BUFFALO).powerOutShare, 0);
  });

  it("is calm and lit without a blizzard scenario", () => {
    const calm = blizzardWeather(null, 100, BUFFALO);
    assert.equal(calm.depthMeters, 0);
    assert.equal(calm.snowfall, 0);
    assert.equal(calm.daylight, 1);
  });
});

// A small town: Main St (an arterial) along y = 0, three side streets running north from it and
// joined at their far ends, an expressway to the south and a ramp from it up to Main St.
const road = (roadClass: number, name: string, path: Point[]): Road => ({ roadClass, name, tunnel: false, path });
const ROADS: Road[] = [
  road(1, "Main Street", [[-50, 0], [0, 0], [100, 0], [200, 0], [300, 0], [400, 0], [450, 0]]),
  road(4, "Elm St", [[100, 0], [100, 150], [100, 300]]),
  road(4, "Oak St", [[200, 0], [200, 150], [200, 300]]),
  road(4, "Ash St", [[300, 0], [300, 150], [300, 300]]),
  road(4, "Back St", [[100, 300], [200, 300], [300, 300]]),
  road(0, "Kensington Expressway", [[-50, -200], [0, -200], [450, -200]]),
  road(0, "", [[0, -200], [0, 0]]),
];
const house = (id: number, [x, y]: Point): Building => ({
  id,
  kind: 0,
  roof: 1,
  walls: 3,
  rise: 2,
  ring: [[x - 5, y - 5], [x + 5, y - 5], [x + 5, y + 5], [x - 5, y + 5]],
  center: [x, y],
});
const HOUSES = [house(0, [150, 12]), house(1, [112, 150]), house(2, [212, 150]), house(3, [288, 220])];

const town = (graph: InkMapData["graph"] = { nodes: [], edges: [] }): InkMapData => ({
  origin: BUFFALO,
  detail: { x0: -50, y0: -250, x1: 450, y1: 350 },
  extent: { x0: -50, y0: -250, x1: 450, y1: 350 },
  terrain: { cols: 2, rows: 2, cell: 1000, x0: -1000, y0: -1000, heights: new Float32Array(4), base: 180 },
  buildings: HOUSES,
  roads: ROADS,
  areas: [],
  trees: new Float32Array(),
  graph,
});

describe("blizzard road closures", () => {
  const data = town();
  const rules = closureRules(buffalo, data);
  const windows = roadWindows(data, rules);

  it("matches Buffalo's closures to street classes, not to the examples in brackets", () => {
    assert.deepEqual(
      rules.map((rule) => rule.classes),
      [[0], [1, 2, 3], [4]],
    );
    assert.equal(windows[0].closedAt, 330);
    assert.equal(windows[0].reopensAt, 2730);
    assert.equal(windows[1].reopensAt, 8069);
    assert.equal(windows[5].closedAt, -210);
    assert.equal(closureStateKey(rules, 100), "100");
    assert.equal(closureStateKey(rules, 2730), "101");
  });

  it("matches a named closure to streets of that name", () => {
    const named: Scenario = { ...buffalo, series: { ...buffalo.series, roadClosures: [{ road: "Oak Street and Elm St", closedAtMinutes: 10 }] } };
    const shut = roadWindows(data, closureRules(named, data));
    assert.deepEqual(
      shut.map((window) => window.closedAt === 10),
      [false, true, true, false, false, false, false],
    );
    assert.equal(streetName("Main  Street."), "main st");
  });

  it("stands a barrier at each side street's mouth on Main St and on the ramp, none where side streets meet", () => {
    const barriers = closureBarriers(data, windows);
    assert.equal(barriers.length, 4);
    const onSideStreets = barriers.filter((barrier) => Math.abs(barrier.at[1] - 10.5) < 0.01);
    assert.equal(onSideStreets.length, 3);
    for (const barrier of onSideStreets) assert.ok(Math.abs(Math.abs(barrier.angle) - Math.PI / 2) < 1e-6);
    assert.ok(barriers.some((barrier) => barrier.at[0] === 0 && barrier.window.closedAt === -210));
  });

  it("cuts off every home once the streets close, and frees the ones on Main St when it is ploughed", () => {
    const network = buildNetwork(data, windows);
    assert.deepEqual(impactAt(data, windows, network, 100).buildings, []);
    assert.deepEqual(impactAt(data, windows, network, 100).roads, [5, 6]);
    assert.deepEqual(impactAt(data, windows, network, 400).buildings, [0, 1, 2, 3]);
    assert.deepEqual(impactAt(data, windows, network, 2730).buildings, [1, 2, 3]);
    assert.deepEqual(impactAt(data, windows, network, -300).roads, []);
  });

  it("reports the dispatcher's edges along closed streets", () => {
    const nodes: Point[] = [[0, 0], [100, 0], [100, 150], [200, 0]];
    const edges = [
      { u: 0, v: 1, seconds: 10, key: "main-a", shape: [nodes[0], nodes[1]] },
      { u: 1, v: 3, seconds: 10, key: "main-b", shape: [nodes[1], nodes[3]] },
      { u: 1, v: 2, seconds: 10, key: "elm", shape: [nodes[1], nodes[2]] },
    ];
    const graphed = town({ nodes, edges });
    const network = buildNetwork(graphed, windows);
    assert.deepEqual(impactAt(graphed, windows, network, 100).edges, []);
    assert.deepEqual(impactAt(graphed, windows, network, 400).edges, ["main-a", "main-b", "elm"]);
    assert.deepEqual(impactAt(graphed, windows, network, 2730).edges, ["elm"]);
    assert.deepEqual(impactAt(graphed, windows, network, 2730).buildings, [1, 2, 3]);
  });
});

describe("blizzard footprint mask", () => {
  it("fills the cells under a footprint", () => {
    const mask = footprintMask([house(0, [5, 5])], { x0: 0, y0: 0, x1: 20, y1: 20 });
    assert.equal(mask.cellMeters, 1);
    assert.equal(mask.cells.reduce((sum, cell) => sum + (cell > 0 ? 1 : 0), 0), 100);
    assert.equal(mask.cells[5 * mask.width + 5], 255);
    assert.equal(mask.cells[15 * mask.width + 15], 0);
  });

  it("keeps the GPU budget and refuses past its limit", () => {
    const budget = new GpuBudget().add("mask", 3 * 1024 ** 2).add("ribbons", 5 * 1024 ** 2);
    assert.equal(budget.total, 8 * 1024 ** 2);
    budget.assertWithin();
    assert.throws(() => budget.add("runaway", MOST_GPU_BYTES).assertWithin(), /Blizzard would need 136 MB/);
  });

  it("measures a street ribbon's buffers", () => {
    const data = town();
    const ribbons = streetRibbons(data, roadWindows(data, closureRules(buffalo, data)), data.extent);
    const index = ribbons.index!;
    assert.equal(geometryBytes(ribbons), ribbons.attributes.position.count * (3 + 4 + 1) * 4 + index.count * (index.array as Uint16Array | Uint32Array).BYTES_PER_ELEMENT);
  });

  it("keeps a large region inside its cell budget", () => {
    const shape = maskShape({ x0: 0, y0: 0, x1: 8000, y1: 6000 });
    assert.ok(shape.width * shape.height <= 3_100_000);
    assert.ok(shape.width <= 4096 && shape.height <= 4096);
  });
});
