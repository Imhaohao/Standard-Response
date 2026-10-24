import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { BUILDING_KIND, Building, Point } from "./data";
import { Construction, Crews, ignitionHazard } from "./ignition";

const raw = JSON.parse(readFileSync(new URL("../../public/map/altadena.json", import.meta.url), "utf8")) as { buildings: number[][] };
const buildings: Building[] = raw.buildings.map((flat, id) => {
  const ring: Point[] = [];
  for (let i = 4; i + 1 < flat.length; i += 2) ring.push([flat[i] / 10, flat[i + 1] / 10]);
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
    assert.ok(fire.burned <= 5, `${fire.burned} buildings burned with three engines`);
  });

  it("spreads further with fewer crews", () => {
    const unanswered = run(0).burned;
    const oneEngine = run(1).burned;
    const threeEngines = run(3).burned;
    assert.ok(unanswered > oneEngine && oneEngine >= threeEngines, `${unanswered} > ${oneEngine} >= ${threeEngines}`);
    assert.ok(unanswered < buildings.length / 10, `${unanswered} of ${buildings.length} buildings burned with no crews`);
  });

  it("spreads less through homes built to the wildfire code", () => {
    const older = run(0, "older").burned;
    const hardened = run(0, "hardened").burned;
    assert.ok(hardened < older, `hardened ${hardened}, older ${older}`);
  });
});
