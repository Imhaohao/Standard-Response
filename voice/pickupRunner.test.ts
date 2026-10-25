import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";
import { dueCall, dueOnThisLine } from "./pickupRunner";

type Plan = FunctionReturnType<typeof api.pickups.callQueue>[number];

const NOW = 1_000_000;

const plan = (partial: Partial<Plan>): Plan =>
  ({
    _id: "plan",
    householdId: "resident",
    helperHouseholdId: "helper",
    status: "checking",
    helperName: "Ana",
    helperPhone: "+15550000002",
    residentPhone: "+15550000001",
    recruited: true,
    helperAttempts: 0,
    residentAttempts: 0,
    confirmAttempts: 0,
    helperNoticeAttempts: 0,
    residentNoticeAttempts: 0,
    address: "1210 Palm St",
    language: "en",
    oxygen: false,
    ...partial,
  }) as Plan;

describe("pickup runner", () => {
  it("asks the helper first, and waits while the helper is on another call with us", () => {
    assert.deepEqual(dueCall(plan({}), NOW), { role: "helper", purpose: "ask" });
    assert.equal(dueCall(plan({}), NOW, (id) => id === "helper"), null);
  });

  it("asks the resident to confirm once the helper says yes, after their own call ends", () => {
    const coming = plan({ status: "coming", helperAttempts: 1, lastAttemptAt: NOW, helperEtaAt: NOW + 600_000 });
    assert.deepEqual(dueCall(coming, NOW), { role: "resident", purpose: "confirm" });
    assert.equal(dueCall(coming, NOW, (id) => id === "resident"), null);
  });

  it("gives the helper the resident's yes before anything else", () => {
    const confirmed = plan({ status: "coming", residentConfirmedAt: NOW, confirmAttempts: 1, helperNotice: "resident_ready", helperEtaAt: NOW - 1 });
    assert.deepEqual(dueCall(confirmed, NOW), { role: "helper", purpose: "notice" });
  });

  it("checks on the resident only once the ETA has passed, confirmed or not", () => {
    const waiting = plan({ status: "coming", residentConfirmedAt: NOW, confirmAttempts: 1, helperEtaAt: NOW + 60_000 });
    assert.equal(dueCall(waiting, NOW), null);
    assert.deepEqual(dueCall({ ...waiting, helperEtaAt: NOW - 1 }, NOW), { role: "resident", purpose: "ask" });
    const neverConfirmed = plan({ status: "coming", confirmAttempts: 2, lastAttemptAt: 0, helperEtaAt: NOW - 1 });
    assert.deepEqual(dueCall(neverConfirmed, NOW), { role: "resident", purpose: "ask" });
  });

  it("calls a helper off after the pickup ended, and retries a missed update after 90 seconds", () => {
    const ended = plan({ status: "fell_through", reason: "resident_declined", helperNotice: "called_off" });
    assert.deepEqual(dueCall(ended, NOW), { role: "helper", purpose: "notice" });
    const missed = { ...ended, helperNoticeAttempts: 1, lastAttemptAt: NOW - 30_000 };
    assert.equal(dueCall(missed, NOW), null);
    assert.deepEqual(dueCall({ ...missed, lastAttemptAt: NOW - 90_000 }, NOW), { role: "helper", purpose: "notice" });
    assert.equal(dueCall({ ...missed, helperNoticeAttempts: 2, lastAttemptAt: 0 }, NOW), null);
  });

  it("waits for each side's own warning call, which asks the pickup question on the same line", () => {
    assert.equal(dueCall(plan({ helperAwaitingCall: true }), NOW), null);
    const coming = plan({ status: "coming", helperEtaAt: NOW + 600_000, residentAwaitingCall: true });
    assert.equal(dueCall(coming, NOW), null);
    assert.deepEqual(dueCall({ ...coming, residentAwaitingCall: false }, NOW), { role: "resident", purpose: "confirm" });
  });

  it("knows what the person on a warning call can be asked before it hangs up", () => {
    assert.deepEqual(dueOnThisLine(plan({}), "helper"), { role: "helper", purpose: "ask" });
    assert.equal(dueOnThisLine(plan({}), "resident"), null);
    const coming = plan({ status: "coming", helperEtaAt: NOW + 600_000 });
    assert.deepEqual(dueOnThisLine(coming, "resident"), { role: "resident", purpose: "confirm" });
    assert.equal(dueOnThisLine(coming, "helper"), null);
    assert.deepEqual(dueOnThisLine(plan({ status: "coming", residentConfirmedAt: NOW, helperNotice: "resident_ready" }), "helper"), { role: "helper", purpose: "notice" });
    assert.equal(dueOnThisLine(plan({ ringing: "helper" }), "helper"), null);
    assert.equal(dueOnThisLine(plan({ helperAttempts: 2 }), "helper"), null);
    assert.equal(dueOnThisLine(plan({}), "someone else"), null);
  });

  it("never rings a plan whose call is already ringing", () => {
    assert.equal(dueCall(plan({ ringing: "helper" }), NOW), null);
  });
});
