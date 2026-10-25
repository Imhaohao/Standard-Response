import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentRecord, Field } from "../agent/record";
import type { AgentLine, CallOutcome } from "./call";
import { readsBack } from "./grade";

const agent = (turn: number, step: AgentLine["step"], text: string): AgentLine => ({
  speaker: "agent", kind: turn === 0 ? "opening" : "reply", turn, parts: [text], text, step, status: "none", rideLine: "", ignored: false,
});

const callOf = (lines: AgentLine[], record: AgentRecord, fieldChangedAt: Partial<Record<Field, number>>): CallOutcome => ({
  item: { language: "en" } as CallOutcome["item"],
  run: 1,
  lines,
  record,
  escalations: [],
  nominations: [],
  lastChangeTurn: Math.max(0, ...Object.values(fieldChangedAt)),
  fieldChangedAt,
  endedAs: "hold",
  unscripted: [],
});

const result = (call: CallOutcome, name: string) => readsBack(call).find((check) => check.name === name);

const GREETING = agent(0, "confirm_address", "Hello, this is 911. Are you at 2609 North Lincoln Avenue right now?");
const FULL = agent(2, "readback", "Let me read that back. 2 people, someone is bedbound, needs two people to lift. Is that right?");

test("a full read-back after a confirmed greeting address covers the record", () => {
  const call = callOf([GREETING, FULL], { address: "2609 North Lincoln Avenue", peopleCount: 2, mobility: "bedbound", assistanceRequired: "two_person_lift", canLeave: "no" }, {
    address: 1, peopleCount: 2, mobility: 2, assistanceRequired: 2, canLeave: 1,
  });
  assert.equal(result(call, "read-back after the last correction")?.pass, true);
  assert.equal(result(call, "read-back matches the record")?.pass, true);
});

test("a correction read back on its own counts, and the rest stays covered by the first summary", () => {
  const first = agent(2, "readback", "Let me read that back. 2 people, someone is bedbound, needs one person to help. Is that right?");
  const fixed = agent(3, "readback", "Thanks, I've fixed that. Needs two people to lift. Is that right?");
  const call = callOf([GREETING, first, fixed], { address: "2609 North Lincoln Avenue", peopleCount: 2, mobility: "bedbound", assistanceRequired: "two_person_lift" }, {
    address: 1, peopleCount: 2, mobility: 2, assistanceRequired: 3,
  });
  assert.equal(result(call, "read-back after the last correction")?.pass, true);
  assert.equal(result(call, "read-back matches the record")?.pass, true);
});

test("a fact that changed after the last read-back is never covered by an older one", () => {
  const first = agent(2, "readback", "Let me read that back. 2 people, someone is bedbound, needs one person to help. Is that right?");
  const moved = agent(3, "neighbor", "Is there anyone else on your street who might not be able to leave?");
  const call = callOf([GREETING, first, moved], { address: "2609 North Lincoln Avenue", peopleCount: 2, mobility: "bedbound", assistanceRequired: "two_person_lift" }, {
    address: 1, peopleCount: 2, mobility: 2, assistanceRequired: 3,
  });
  assert.equal(result(call, "read-back after the last correction")?.pass, false);
});

test("a summary that leaves out a fact fails and names it", () => {
  const partial = agent(2, "readback", "Let me read that back. 2 people, someone is bedbound. Is that right?");
  const call = callOf([GREETING, partial], { address: "2609 North Lincoln Avenue", peopleCount: 2, mobility: "bedbound", assistanceRequired: "two_person_lift" }, {
    address: 1, peopleCount: 2, mobility: 2, assistanceRequired: 2,
  });
  const matches = result(call, "read-back matches the record");
  assert.equal(matches?.pass, false);
  assert.match(matches?.detail ?? "", /assistanceRequired/);
});

test("an address the caller gave later must be said back after they gave it", () => {
  const call = callOf([GREETING, FULL], { address: "45 East Mariposa Street", peopleCount: 2, mobility: "bedbound", assistanceRequired: "two_person_lift" }, {
    address: 2, peopleCount: 2, mobility: 2, assistanceRequired: 2,
  });
  const matches = result(call, "read-back matches the record");
  assert.equal(matches?.pass, false);
  assert.match(matches?.detail ?? "", /address/);
});
