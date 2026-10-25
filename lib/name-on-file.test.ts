import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nameOnFile } from "./name-on-file";

const NAMES = ["Boris Nezlobin", "Brendan Giang", "Jerry", "Rogelio Ramírez", "Ana Morales", "Ana Vega"];

describe("a neighbor named on a call, found on file", () => {
  it("matches a first or last name said as a whole word", () => {
    assert.equal(nameOnFile("Boris, bedridden", NAMES), "Boris Nezlobin");
    assert.equal(nameOnFile("the Giang house", NAMES), "Brendan Giang");
    assert.equal(nameOnFile("Rogelio Ramirez down the street", NAMES), "Rogelio Ramírez");
  });

  it("finds nobody when no name or two people fit", () => {
    assert.equal(nameOnFile("a man down the road", NAMES), undefined);
    assert.equal(nameOnFile("Ana, next door", NAMES), undefined);
    assert.equal(nameOnFile("Borison", NAMES), undefined);
  });
});
