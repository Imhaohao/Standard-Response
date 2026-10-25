import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { env, mayDial } from "./env";

describe("mayDial", () => {
  it("rings any real number under *, but never a 555 number", () => {
    env.dialAllowlist.splice(0, env.dialAllowlist.length, "*");
    assert.equal(mayDial("+16502234376"), true);
    assert.equal(mayDial("+16265551001"), false);
  });

  it("rings only listed numbers without *", () => {
    env.dialAllowlist.splice(0, env.dialAllowlist.length, "+16502234376");
    assert.equal(mayDial("+16502234376"), true);
    assert.equal(mayDial("+14252468208"), false);
  });
});
