import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mayDialOnWarning, setCallList } from "./callList";
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

describe("mayDialOnWarning", () => {
  it("rings only the Real phones switched on, even under *", () => {
    env.dialAllowlist.splice(0, env.dialAllowlist.length, "*");
    setCallList(["+14252468208", "+18584284624"]);
    assert.equal(mayDialOnWarning("+14252468208"), true);
    assert.equal(mayDialOnWarning("(858) 428-4624"), true);
    // A real-looking number someone else signed up with. Nothing here dials it.
    assert.equal(mayDialOnWarning("+16502230000"), false);
  });

  it("rings nobody before the list has loaded", () => {
    env.dialAllowlist.splice(0, env.dialAllowlist.length, "*");
    setCallList([]);
    assert.equal(mayDialOnWarning("+14252468208"), false);
  });

  it("still needs DIAL_ALLOWLIST", () => {
    env.dialAllowlist.splice(0, env.dialAllowlist.length, "+16502234376");
    setCallList(["+16502234376", "+16507099911"]);
    assert.equal(mayDialOnWarning("+16502234376"), true);
    assert.equal(mayDialOnWarning("+16507099911"), false);
  });
});
