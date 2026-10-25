import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { streetWasSaid } from "./conversation";
import { parse } from "./interpreter";

const addressFrom = (spoken: string) => parse(JSON.stringify({ set: [`address=${spoken}`] }), "en", "wildfire").updates.address;

describe("the address Claude hears", () => {
  it("keeps a house number or a street", () => {
    assert.equal(addressFrom("3037 Ewing Street"), "3037 Ewing Street");
    assert.equal(addressFrom("Catherine Road"), "Catherine Road");
    assert.equal(addressFrom("calle Mariposa"), "calle Mariposa");
  });

  // Voice exam: "mom's house" was recorded, so the agent never asked for an address it could send.
  it("drops a place nobody could drive to", () => {
    assert.equal(addressFrom("mom's house"), undefined);
    assert.equal(addressFrom("my sister's place"), undefined);
    assert.equal(addressFrom("none"), undefined);
  });
});

describe("an address nobody on the call said", () => {
  it("counts a street said, spelled out, or already on record", () => {
    assert.equal(streetWasSaid("486 West Mariposa Street", "Four eight six West Mariposa."), true);
    assert.equal(streetWasSaid("486 West Mariposa Street", "four eight six, M, A, R, I, P, O, S, A"), true);
    assert.equal(streetWasSaid("2585 Catherine Road", "two five eight five Catherine Road"), true);
  });

  // Voice exam: "Can you please send someone to my mom's house?" was read as 3426 Catherine Road.
  it("doesn't count a street only Claude wrote", () => {
    assert.equal(streetWasSaid("3426 Catherine Road", "Can you please send someone to my mom's house?"), false);
  });
});
