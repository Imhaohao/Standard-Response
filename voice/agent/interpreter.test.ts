import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
