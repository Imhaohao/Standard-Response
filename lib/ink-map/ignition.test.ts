import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { BUILDING_KIND, Building, InkMapData, Point } from "./data";
import { contains } from "./fire-field";
import { Construction, Crews, ignitionHazard } from "./ignition";
import { streetNetwork } from "./street-network";
import { warningZoneAround } from "./warning-zone";

const raw = JSON.parse(readFileSync(new URL("../../public/map/altadena.json", import.meta.url), "utf8")) as { buildings: number[][]; roads: number[][] };
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

// A house with plenty of other houses within a block, so the fire has somewhere to go.
function crowdedHouse(): Point {
  const houses = buildings.filter((building) => building.kind === BUILDING_KIND.house);
  const crowding = (house: Building) => houses.filter((other) => Math.hypot(other.center[0] - house.center[0], other.center[1] - house.center[1]) < 60).length;
  return houses.slice(0, 4000).reduce((best, house) => (crowding(house) > crowding(best) ? house : best)).center;
}

const ignition = crowdedHouse();
const SOUTHWEST: Point = [-Math.SQRT1_2, -Math.SQRT1_2];
const run = (engines: Crews, construction: Construction = "older") => ignitionHazard(buildings, ignition, SOUTHWEST, { engines, construction })!;

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

describe("warning zone around a simulated fire", () => {
  const roads = raw.roads.map((road) => ({ roadClass: road[0], name: "", tunnel: road[2] === 1, path: decodePoints(road, 3) }));
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

  it("draws nothing rather than a zone that misses the fire", () => {
    const pastTheStreets: Point[] = [[-1e5, -1e5]];
    assert.equal(warningZoneAround(network, pastTheStreets), null);
  });
});
