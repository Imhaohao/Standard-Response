import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPhoneAsTyped } from "./phone-number";

const typed = (keys: string) => [...keys].reduce((value, key) => formatPhoneAsTyped(value + key), "");

describe("a phone number formatted as it is typed", () => {
  it("groups a US number digit by digit", () => {
    assert.equal(typed("626"), "626");
    assert.equal(typed("6265"), "(626) 5");
    assert.equal(typed("6265550"), "(626) 555-0");
    assert.equal(typed("6265550142"), "(626) 555-0142");
  });

  it("stops at ten digits", () => {
    assert.equal(typed("62655501429"), "(626) 555-0142");
  });

  it("backs out of a dash or bracket without sticking", () => {
    assert.equal(formatPhoneAsTyped("(626) 555-"), "(626) 555");
    assert.equal(formatPhoneAsTyped("(626) "), "626");
  });

  it("keeps a leading 1 or +1 as the country code", () => {
    assert.equal(typed("16265550142"), "1 (626) 555-0142");
    assert.equal(formatPhoneAsTyped("+1 626 555 0142"), "+1 (626) 555-0142");
    assert.equal(formatPhoneAsTyped("+1"), "+1");
  });

  it("formats a pasted or autofilled number", () => {
    assert.equal(formatPhoneAsTyped("626.555.0142"), "(626) 555-0142");
  });

  it("leaves other countries as typed", () => {
    assert.equal(formatPhoneAsTyped("+44 20 7946 0958"), "+44 20 7946 0958");
  });
});
