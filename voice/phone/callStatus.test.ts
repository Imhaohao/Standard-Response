import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unreachedCall } from "./callStatus";

// The status webhook's query string, as placeCall builds it, for each kind of outbound call.
const statusQuery = (fields: Record<string, string>) =>
  new URLSearchParams({ mode: "", callId: "", callbackId: "", householdId: "", planId: "", role: "", ...fields });

const OUTBOUND = [
  { mode: "survey", fields: { callId: "call1", householdId: "home1" }, expect: { callId: "call1", householdId: "home1" } },
  { mode: "callback", fields: { callbackId: "cb1" }, expect: { callbackId: "cb1" } },
  { mode: "plan_check", fields: { planId: "plan1", role: "helper", purpose: "ask" }, expect: { planId: "plan1", role: "helper", purpose: "ask" } },
  { mode: "ready", fields: { householdId: "home2" }, expect: { householdId: "home2" } },
] as const;

describe("unreachedCall", () => {
  for (const { mode, fields, expect } of OUTBOUND) {
    it(`reports a ${mode} call our stream never joined as a miss, whatever Twilio's status`, () => {
      const ended = unreachedCall(statusQuery({ mode, ...fields }), false);
      assert.deepEqual(ended, {
        mode,
        callId: undefined,
        callbackId: undefined,
        householdId: undefined,
        planId: undefined,
        role: undefined,
        purpose: undefined,
        ...expect,
        answered: false,
      });
    });

    it(`leaves a ${mode} call our stream joined to its call session`, () => {
      assert.equal(unreachedCall(statusQuery({ mode, ...fields }), true), null);
    });
  }

  it("ignores a status for an inbound or unknown call", () => {
    assert.equal(unreachedCall(statusQuery({ mode: "inbound" }), false), null);
    assert.equal(unreachedCall(statusQuery({ mode: "other" }), false), null);
  });

  it("drops a role or purpose it doesn't know", () => {
    const ended = unreachedCall(statusQuery({ mode: "plan_check", planId: "plan1", role: "driver", purpose: "chat" }), false);
    assert.equal(ended?.role, undefined);
    assert.equal(ended?.purpose, undefined);
  });
});
