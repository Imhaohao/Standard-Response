import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Situation } from "../../convex/voice";
import { briefText, CallFacts, fireLine, routeLine } from "./brief";

const NOW = 1_000_000_000_000;
const SITUATION: Situation = {
  hazard: "wildfire",
  warningIssuedAt: NOW - 20 * 60_000,
  fireArrivalAt: NOW + 38 * 60_000,
  hazardReaches: true,
  route: { streets: ["Lincoln Avenue", "Woodbury Road"], minutes: 12, destination: "Pasadena Convention Center" },
  fireUnits: 3,
  homesWaitingForCrew: 7,
  onCrewList: false,
};
const facts = (overrides: Partial<CallFacts> = {}): CallFacts => ({
  situation: SITUATION,
  ride: null,
  edge: { meters: 2253, direction: "northeast" },
  now: NOW,
  ...overrides,
});

describe("the 911 screen", () => {
  it("gives Claude the disaster, the fire, the way out, the ride and the crews", () => {
    const text = briefText(facts());
    assert.match(text, /wildfire evacuation, west Altadena; evacuation warning in effect/);
    assert.match(text, /reaching this home in about 38 minutes/);
    assert.match(text, /about 1\.4 miles to the north-east/);
    assert.match(text, /Lincoln Avenue, then Woodbury Road to Pasadena Convention Center, about 12 minutes/);
    assert.match(text, /Ride: no request yet/);
    assert.match(text, /4 engines \(Engine 12, Engine 11, Engine 82, Engine 19\) work the door-check list; 7 homes are waiting on it/);
  });

  it("says where the fire is and how long until it may arrive, in the call language", () => {
    assert.equal(fireLine(facts(), "en"), "Our fire map shows the fire about 1.4 miles to your northeast. It could reach your street in about 38 minutes.");
    assert.match(fireLine(facts(), "es") ?? "", /1\.4 millas al noreste/);
  });

  it("says the fire is at the street once the model has it there", () => {
    const arrived = facts({ situation: { ...SITUATION, fireArrivalAt: NOW - 60_000 } });
    assert.match(fireLine(arrived, "en") ?? "", /at your street now/);
  });

  it("stays quiet about a fire that never reaches the home, or before the warning", () => {
    assert.equal(fireLine(facts({ situation: { ...SITUATION, hazardReaches: false } }), "en"), null);
    assert.equal(fireLine(facts({ situation: { ...SITUATION, warningIssuedAt: null } }), "en"), null);
  });

  it("reads the fastest drive out", () => {
    assert.equal(routeLine(facts(), "en"), "The fastest way out right now is Lincoln Avenue, then Woodbury Road, toward Pasadena Convention Center. That's about 12 minutes by car.");
    assert.equal(routeLine(facts({ situation: { ...SITUATION, route: null } }), "en"), null);
  });
});
