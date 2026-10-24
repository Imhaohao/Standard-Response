import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spokenForm } from "./cartesia";

describe("spoken form", () => {
  it("spells out ID so Sonic doesn't say Idaho", () => {
    assert.equal(spokenForm("your medications, glasses, ID and phone charger"), "your medications, glasses, I-D and phone charger");
    assert.equal(spokenForm("Bring your I.D. with you."), "Bring your I-D with you.");
    assert.equal(spokenForm("Bring your ID."), "Bring your I-D.");
  });

  it("leaves words that only contain the letters alone", () => {
    assert.equal(spokenForm("IDK, the idea was Idaho Street"), "IDK, the idea was Idaho Street");
  });
});
