import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Id } from "../../convex/_generated/dataModel";
import { Candidate, lineFor, parseRanking } from "./callPlanner";

const home = (id: string, partial: Partial<Candidate> = {}): Candidate => ({
  _id: id as Id<"households">,
  minutesLeft: 30,
  needProbability: 0.2,
  callStatus: "not_called",
  attempts: 0,
  peopleCount: undefined,
  canLeave: undefined,
  hasCar: undefined,
  mobility: undefined,
  assistanceRequired: undefined,
  medical: undefined,
  exitPlan: undefined,
  ...partial,
});

describe("call planner", () => {
  it("writes only the facts we know", () => {
    assert.equal(lineFor(home("a"), 0), "#1 | 30 min left | need 0.20 | not called yet");
    const known = home("b", { callStatus: "no_answer", attempts: 2, hasCar: false, mobility: "power_wheelchair", medical: ["oxygen"] });
    assert.equal(lineFor(known, 1), "#2 | 30 min left | need 0.20 | missed 2 calls | no car | mobility power_wheelchair | medical oxygen");
  });

  it("maps Claude's numbers back to homes and drops repeats and unknown numbers", () => {
    const homes = [home("a"), home("b"), home("c")];
    const text = JSON.stringify({
      ranked: [
        { home: 3, reason: " Oxygen, no car. " },
        { home: 9, reason: "not a home" },
        { home: 3, reason: "again" },
        { home: 1, reason: "Fire in 8 minutes." },
      ],
    });
    assert.deepEqual(parseRanking(text, homes), [
      { householdId: "c", reason: "Oxygen, no car." },
      { householdId: "a", reason: "Fire in 8 minutes." },
    ]);
  });
});
