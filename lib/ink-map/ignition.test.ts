import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AREA_KIND, Area, BUILDING_KIND, Building, InkMapData, Point, Road } from "./data";
import { fireGround } from "./fire-barriers";
import { contains } from "./fire-field";
import { Construction, Crews, ignitionHazard } from "./ignition";
import { windWalk } from "./wind-walk";
import { streetNetwork } from "./street-network";
import { warningZoneAround } from "./warning-zone";

const raw = JSON.parse(readFileSync(new URL("../../public/map/altadena.json", import.meta.url), "utf8")) as { buildings: number[][]; roads: number[][]; areas: number[][] };
const decodePoints = (flat: number[], start: number) => {
  const points: Point[] = [];
  for (let i = start; i + 1 < flat.length; i += 2) points.push([flat[i] / 10, flat[i + 1] / 10]);
  return points;
};
const buildings: Building[] = raw.buildings.map((flat, id) => {
  const ring = decodePoints(flat, 4);
  const center: Point = [ring.reduce((sum, p) => sum + p[0], 0) / ring.length, ring.reduce((sum, p) => sum + p[1], 0) / ring.length];
  return { id, kind: flat[0], roof: flat[1], walls: flat[2] / 10, rise: flat[3] / 10, ring, center };
});

// A house in central west Altadena with plenty of other houses within a block, so the fire has
// somewhere to go. Picked by place, not by its position in the baked list, which follows OSM's order.
const NEIGHBOURHOOD: Point = [1518, 835];
const NEIGHBOURHOOD_METERS = 400;

function crowdedHouse(): Point {
  const houses = buildings.filter((building) => building.kind === BUILDING_KIND.house);
  const near = (a: Point, b: Point, meters: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) < meters;
  const crowding = (house: Building) => houses.filter((other) => near(other.center, house.center, 60)).length;
  const candidates = houses.filter((house) => near(house.center, NEIGHBOURHOOD, NEIGHBOURHOOD_METERS));
  return candidates.reduce((best, house) => (crowding(house) > crowding(best) ? house : best)).center;
}

const roads: Road[] = raw.roads.map((road) => ({ roadClass: road[0], name: "", tunnel: road[2] === 1, path: decodePoints(road, 3) }));
const areas: Area[] = raw.areas.map((area) => ({ kind: area[0], ring: decodePoints(area, 1) }));
const ground = { roads, areas };

const ignition = crowdedHouse();
const FOOTHILL_HOUSE: Point = [1106, 1701];
const SOUTHWEST: Point = [-Math.SQRT1_2, -Math.SQRT1_2];
const run = (engines: Crews, construction: Construction = "older", over = ground) => ignitionHazard(buildings, ignition, SOUTHWEST, { engines, construction }, over)!;

describe("simulated house fire", () => {
  it("stays a house fire when crews reach it in time", () => {
    const fire = run(3);
    assert.ok(fire.outAt !== null, "three engines should put it out");
    assert.ok(fire.burnedAt.length <= 5, `${fire.burnedAt.length} buildings burned with three engines`);
  });

  it("spreads further with fewer crews", () => {
    const unanswered = run(0).burnedAt.length;
    const oneEngine = run(1).burnedAt.length;
    const threeEngines = run(3).burnedAt.length;
    assert.ok(unanswered > oneEngine && oneEngine >= threeEngines, `${unanswered} > ${oneEngine} >= ${threeEngines}`);
    assert.ok(unanswered < buildings.length / 10, `${unanswered} of ${buildings.length} buildings burned with no crews`);
  });

  it("spreads less through homes built to the wildfire code", () => {
    const older = run(0, "older").burnedAt.length;
    const hardened = run(0, "hardened").burnedAt.length;
    assert.ok(hardened < older, `hardened ${hardened}, older ${older}`);
  });
});

describe("what the fire meets", () => {
  it("is held by the roads, washes and open ground between buildings", () => {
    const open = run(0, "older", { roads: [], areas: [] }).burnedAt.length;
    const held = run(0).burnedAt.length;
    assert.ok(held < open, `${held} buildings burned with the ground, ${open} without`);
  });

  it("finds the Arroyo Seco and the streets between two points across it", () => {
    const crossing = fireGround(ground)([-1900, -2000], [-900, -2000]);
    assert.ok(crossing.water, "the Arroyo Seco channel wasn't crossed");
    assert.ok(crossing.widestRoad !== null && crossing.widestRoad <= 4, `widest road class ${crossing.widestRoad}`);
  });

  it("reads open ground in the middle of a gap", () => {
    const middle = (ring: Point[]) => ring.reduce<Point>((sum, [px, py]) => [sum[0] + px / ring.length, sum[1] + py / ring.length], [0, 0]);
    const park = areas.find((area) => area.kind === AREA_KIND.park && contains(area.ring, ...middle(area.ring)))!;
    const [x, y] = middle(park.ring);
    assert.equal(fireGround(ground)([x - 1, y], [x + 1, y]).ground, AREA_KIND.park);
  });

  it("leaves some buildings standing inside the burn", () => {
    const fire = run(0);
    const burned = new Set(fire.burnedAt.map(([x, y]) => `${x},${y}`));
    const hull = fire.field.fronts[fire.field.fronts.length - 1].ring;
    const standing = buildings.filter((b) => contains(hull, b.center[0], b.center[1]) && !burned.has(`${b.center[0]},${b.center[1]}`));
    assert.ok(standing.length > 0, "every building inside the burn caught");
  });

  it("burns the same way every time it is lit at the same house", () => {
    assert.deepEqual(run(1).burnedAt, run(1).burnedAt);
  });

  it("swings the wind by tens of degrees and gusts, the same way for the same seed", () => {
    const wind = windWalk(SOUTHWEST, 42, 240);
    const headings = Array.from({ length: 49 }, (_, step) => {
      const [x, y] = wind(step * 5).direction;
      return (Math.atan2(x, y) * 180) / Math.PI;
    });
    const strengths = Array.from({ length: 49 }, (_, step) => wind(step * 5).strength);
    assert.ok(Math.max(...headings) - Math.min(...headings) > 20, `heading range ${Math.max(...headings) - Math.min(...headings)}`);
    assert.ok(Math.max(...strengths) > 1.1 && Math.min(...strengths) < 0.9, "no gusts or lulls");
    assert.deepEqual(windWalk(SOUTHWEST, 42, 240)(120), wind(120));
  });
});

describe("warning zone around a simulated fire", () => {
  const network = streetNetwork({ roads } as unknown as InkMapData);

  for (const engines of [1, 0] as const) {
    it(`runs along the streets around every building that burns with ${engines === 1 ? "one engine" : "no crews"}`, () => {
      const fire = run(engines);
      const zone = warningZoneAround(network, fire.burnedAt);
      assert.ok(zone, "no zone drawn");
      assert.ok(zone.corners.length >= 3, `${zone.corners.length} corners`);
      assert.ok(fire.burnedAt.every(([x, y]) => contains(zone.ring, x, y)), "a burned building is outside the zone");
    });
  }

  // Lit near the top of the street grid, it burns up into homes on hillside roads that only join
  // each other by way of the town below. The zone has to cross the wildland between them.
  it("holds a fire that burns up into the foothills", () => {
    const fire = ignitionHazard(buildings, FOOTHILL_HOUSE, SOUTHWEST, { engines: 1, construction: "older" })!;
    const zone = warningZoneAround(network, fire.burnedAt);
    assert.ok(zone, `no zone drawn around ${fire.burnedAt.length} burned buildings`);
    assert.ok(fire.burnedAt.every(([x, y]) => contains(zone.ring, x, y)), "a burned building is outside the zone");
  });

  it("draws nothing rather than a zone that misses the fire", () => {
    const pastTheStreets: Point[] = [[-1e5, -1e5]];
    assert.equal(warningZoneAround(network, pastTheStreets), null);
  });
});
