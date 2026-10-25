import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { helperOnTheWayLine, minutesUntil, PickupNeeds, PlanCheck, PlanCheckEffects, PlanCheckOptions } from "./planCheck";
import type { PlanHeard, PlanRole } from "./planInterpreter";
import { HelperOnFile, ReadyCall, ReadyProfileArgs, spokenDigits } from "./readyCall";
import type { ReadyHeard } from "./readyInterpreter";

type Recorded = { helper: [boolean, number | undefined][]; resident: boolean[]; confirmed: boolean[]; notices: number; escalations: string[]; unreached: number };

const heard = (partial: Partial<PlanHeard>): PlanHeard => ({
  answer: "unclear",
  minutes: null,
  emergency: "none",
  wantsRepeat: false,
  addressedToAgent: true,
  acknowledgment: "",
  ...partial,
});

function planCall(
  role: PlanRole,
  answers: Partial<PlanHeard>[],
  language: "en" | "es" | "ko" = "en",
  recruited = false,
  needs?: PickupNeeds,
  extra: Partial<PlanCheckOptions> = {},
) {
  const recorded: Recorded = { helper: [], resident: [], confirmed: [], notices: 0, escalations: [], unreached: 0 };
  const effects: PlanCheckEffects = {
    helperAnswered: (coming, eta) => recorded.helper.push([coming, eta]),
    residentAnswered: (pickedUp) => recorded.resident.push(pickedUp),
    residentConfirmed: (confirmed) => recorded.confirmed.push(confirmed),
    noticeHeard: () => (recorded.notices += 1),
    escalate: (kind) => recorded.escalations.push(kind),
    unreached: () => (recorded.unreached += 1),
  };
  const queue = [...answers];
  const call = new PlanCheck({
    role,
    language,
    helperName: "Ana",
    residentName: "Walter",
    address: "1182 Mariposa St",
    recruited,
    needs,
    effects,
    interpret: async () => heard(queue.shift() ?? {}),
    ...extra,
  });
  return { call, recorded };
}

const spoken = (turn: { acknowledgment: string; sentences: string[] }) => [turn.acknowledgment, ...turn.sentences].join(" ");

describe("pickup check, helper call", () => {
  it("introduces itself as 911 and never tells the helper to call 911", async () => {
    const { call } = planCall("helper", [{ answer: "no", emergency: "flames" }]);
    const opening = spoken(call.start());
    assert.match(opening, /this is 911/);
    assert.doesNotMatch(spoken(await call.hear("no, and there's fire here")), /call 911/i);
  });

  it("tells the helper what the pickup takes before asking", () => {
    const { call } = planCall("helper", [], "en", false, { mobility: "walker", assistance: "one_person_assist", oxygen: true });
    const turn = call.start();
    assert.deepEqual(turn.sentences.slice(1, 4), ["They use a walker.", "They need one person to help them to the car.", "They use oxygen."]);
    assert.equal(turn.sentences.at(-1), "Can you get to them now?");
  });

  it("says nothing extra about someone who walks", () => {
    const turn = planCall("helper", [], "en", false, { mobility: "walks", assistance: "none" }).call.start();
    assert.equal(turn.sentences.length, 2);
  });

  it("asks a neighbor found during the warning to pick them up and drive them out", async () => {
    const { call, recorded } = planCall("helper", [{ answer: "yes", minutes: 5 }], "en", true);
    const opening = spoken(call.start());
    assert.match(opening, /Your neighbor Walter at 1182 Mariposa St can't get out on their own/);
    assert.match(opening, /Could you pick them up and drive them out\?/);
    assert.doesNotMatch(opening, /you're down to pick them up/);
    assert.equal((await call.hear("sure, five minutes")).done, true);
    assert.deepEqual(recorded.helper, [[true, 5]]);
  });

  it("gives a helper who said yes the resident's number", async () => {
    const effects: PlanCheckEffects = { helperAnswered: () => undefined, residentAnswered: () => undefined, residentConfirmed: () => undefined, noticeHeard: () => undefined, escalate: () => undefined, unreached: () => undefined };
    const call = new PlanCheck({ role: "helper", language: "en", helperName: "Ana", residentName: "Wen", address: "915 Ventura Street", residentPhone: "+16506567040", recruited: true, effects, interpret: async () => heard({ answer: "yes", minutes: 5 }) });
    call.start();
    assert.match(spoken(await call.hear("yes, five minutes")), /Wen's number is 6 5 0, 6 5 6, 7 0 4 0, if you need to reach them\./);
  });

  it("asks for minutes after a plain yes, then reports the helper coming", async () => {
    const { call, recorded } = planCall("helper", [{ answer: "yes" }, { minutes: 12 }]);
    assert.match(spoken(call.start()), /Can you get to them now\?/);
    assert.match(spoken(await call.hear("yes")), /how many minutes/);
    const last = await call.hear("about twelve");
    assert.equal(last.done, true);
    assert.deepEqual(recorded.helper, [[true, 12]]);
    assert.match(spoken(last), /check in with Walter/);
  });

  it("skips the minutes question when the yes comes with a time", async () => {
    const { call, recorded } = planCall("helper", [{ answer: "yes", minutes: 10 }]);
    call.start();
    assert.equal((await call.hear("yes, ten minutes")).done, true);
    assert.deepEqual(recorded.helper, [[true, 10]]);
  });

  it("counts two unclear answers as no", async () => {
    const { call, recorded } = planCall("helper", [{}, {}]);
    call.start();
    assert.equal((await call.hear("hmm")).done, false);
    const last = await call.hear("maybe");
    assert.equal(last.done, true);
    assert.deepEqual(recorded.helper, [[false, undefined]]);
    assert.match(spoken(last), /another way/);
  });

  it("never invents a time when the helper can't say how long", async () => {
    const { call, recorded } = planCall("helper", [{ answer: "yes" }, {}, {}]);
    call.start();
    await call.hear("yes");
    await call.hear("not sure");
    await call.hear("depends on traffic");
    assert.deepEqual(recorded.helper, [[true, undefined]]);
  });

  it("ignores noise without using up a try", async () => {
    const { call, recorded } = planCall("helper", [{ addressedToAgent: false }, {}, { answer: "no" }]);
    call.start();
    assert.equal((await call.hear("woof")).ignored, true);
    await call.hear("what?");
    await call.hear("no, I can't");
    assert.deepEqual(recorded.helper, [[false, undefined]]);
  });

  it("tells a helper in danger to leave without escalating the resident's home", async () => {
    const { call, recorded } = planCall("helper", [{ emergency: "flames", answer: "no" }]);
    call.start();
    assert.match(spoken(await call.hear("there's fire on my street, I can't")), /leave now, and don't go to them/);
    assert.deepEqual(recorded.escalations, []);
  });

  it("reports a hang-up before any answer as unreached, once", async () => {
    const { call, recorded } = planCall("helper", []);
    call.start();
    call.lineClosed();
    call.lineClosed();
    assert.equal(recorded.unreached, 1);
  });
});

describe("pickup check, resident call", () => {
  it("tells the resident what the helper offered and asks them to confirm", async () => {
    const { call, recorded } = planCall("resident", [{ answer: "yes" }], "en", true, undefined, { purpose: "confirm", minutes: 10, helperPhone: "+14252468208" });
    const opening = spoken(call.start());
    assert.match(opening, /it's 911 calling about your pickup/);
    assert.match(opening, /Ana says they can pick you up in about 10 minutes\. Their number is 4 2 5, 2 4 6, 8 2 0 8\./);
    assert.match(opening, /Will you go with Ana when they get there\?$/);
    const turn = await call.hear("yes, I'll be ready");
    assert.equal(turn.done, true);
    assert.match(spoken(turn), /I'll let them know you'll be ready/);
    assert.deepEqual(recorded.confirmed, [true]);
    call.lineClosed();
    assert.equal(recorded.unreached, 0);
  });

  it("lets the helper turn back when the resident says no, without promising a van", async () => {
    const { call, recorded } = planCall("resident", [{ answer: "no" }], "en", true, undefined, { purpose: "confirm", minutes: 10 });
    call.start();
    const turn = await call.hear("no, my son is coming");
    assert.deepEqual(recorded.confirmed, [false]);
    assert.match(spoken(turn), /I'll tell Ana they don't need to come/);
    assert.match(spoken(turn), /I'll call you back as soon as a driver has said yes/);
  });

  it("leaves the helper coming after two answers it can't read", async () => {
    const { call, recorded } = planCall("resident", [{}, {}], "en", true, undefined, { purpose: "confirm", minutes: 10 });
    call.start();
    assert.equal((await call.hear("hmm")).done, false);
    const turn = await call.hear("what");
    assert.equal(turn.done, true);
    assert.match(spoken(turn), /Ana is still on the way/);
    assert.deepEqual(recorded.confirmed, []);
    assert.equal(recorded.unreached, 1);
  });

  it("gives a status update with nothing to answer, and counts it heard as soon as it's said", () => {
    const { call, recorded } = planCall("helper", [], "en", true, undefined, { purpose: "notice", notice: "resident_ready" });
    const turn = call.start();
    assert.equal(turn.done, true);
    assert.match(spoken(turn), /Hi Ana, it's 911 with an update on the pickup\. Walter said yes, and will be ready for you at 1182 Mariposa St\./);
    assert.equal(recorded.notices, 1);
    call.lineClosed();
    assert.equal(recorded.unreached, 0);
  });

  it("calls a helper off, and tells a resident their helper can't come with the safety line", () => {
    const off = planCall("helper", [], "en", true, undefined, { purpose: "notice", notice: "called_off" });
    assert.match(spoken(off.call.start()), /The pickup for Walter at 1182 Mariposa St is off, so you don't need to go\./);
    const cancelled = planCall("resident", [], "es", true, undefined, { purpose: "notice", notice: "helper_cancelled" });
    const said = spoken(cancelled.call.start());
    assert.match(said, /Ana ya no puede pasar por usted\./);
    assert.match(said, /sigue abierta/);
  });

  it("gives the same notice in Spanish, and without minutes when the helper gave none", () => {
    assert.match(helperOnTheWayLine("es", "Ana", 1), /Ana dice que puede pasar por usted en 1 minuto\./);
    assert.match(helperOnTheWayLine("en", "the neighbor at 1190 Mariposa St", undefined), /^The neighbor at 1190 Mariposa St says they can pick you up soon\./);
    assert.equal(minutesUntil(undefined, 0), undefined);
    assert.equal(minutesUntil(10_000, 0), 1);
    assert.equal(minutesUntil(600_000, 0), 10);
  });

  it("records a pickup", async () => {
    const { call, recorded } = planCall("resident", [{ answer: "yes" }]);
    assert.match(spoken(call.start()), /Has Ana picked you up\?/);
    assert.equal((await call.hear("yes, I'm in the car")).done, true);
    assert.deepEqual(recorded.resident, [true]);
    call.lineClosed();
    assert.equal(recorded.unreached, 0);
  });

  it("promises no pickup or time when nobody came, and gives the safety line", async () => {
    const { call, recorded } = planCall("resident", [{ answer: "no", acknowledgment: "Okay, a driver is coming soon." }]);
    call.start();
    const last = await call.hear("no, nobody came");
    assert.deepEqual(recorded.resident, [false]);
    const text = spoken(last);
    assert.match(text, /finding you a vehicle/);
    assert.match(text, /call this number back/);
    assert.doesNotMatch(text, /coming soon|\d+ minutes/);
  });

  it("escalates a medical emergency at the home", async () => {
    const { call, recorded } = planCall("resident", [{ emergency: "medical", answer: "no" }]);
    call.start();
    await call.hear("no, and I can't breathe");
    assert.deepEqual(recorded.escalations, ["medical"]);
  });

  it("speaks Spanish, and falls back to English for other languages", async () => {
    assert.match(spoken(planCall("resident", [], "es").call.start()), /recogió/);
    const korean = planCall("resident", [], "ko").call;
    assert.equal(korean.language, "en");
    assert.match(spoken(korean.start()), /picked you up/);
  });
});

const readyHeard = (partial: Partial<ReadyHeard>): ReadyHeard => ({
  answer: null,
  updates: {},
  emergency: false,
  asksAboutRide: false,
  wantsRepeat: false,
  wantsToEnd: false,
  addressedToAgent: true,
  acknowledgment: "",
  ...partial,
});

function readyCall(answers: Partial<ReadyHeard>[], helperOnFile?: HelperOnFile) {
  const saved: ReadyProfileArgs[] = [];
  const queue = [...answers];
  const call = new ReadyCall({
    language: "en",
    addressOnFile: "1182 Mariposa St",
    helperOnFile,
    effects: { save: (profile) => saved.push(profile) },
    interpret: async () => readyHeard(queue.shift() ?? {}),
  });
  return { call, saved };
}

describe("Ready check call", () => {
  it("walks a household with a helper through to a saved profile", async () => {
    const { call, saved } = readyCall([
      { answer: "yes" },
      { answer: "yes" },
      { updates: { peopleCount: 2, pets: false } },
      { updates: { mobility: "walker" } },
      { updates: { assistanceRequired: "one_person_assist" } },
      { updates: { bedroomFloor: "upstairs", bedroomSide: "back" } },
      { updates: { care: ["hearing"] } },
      { updates: { exitPlan: "helper", helperName: "Ana" } },
      { updates: { helperPhone: "+16265550123" } },
      { answer: "yes" },
      { updates: { note: "Key under the mat" } },
      { answer: "yes" },
    ]);
    call.start();
    const turns = [];
    while (!call.done) turns.push(spoken(await call.hear("…")));
    assert.match(turns[8], /6 2 6, 5 5 5, 0 1 2 3/);
    assert.match(turns[10], /Ana would pick you up/);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].helper, { name: "Ana", phone: "+16265550123", relation: undefined });
    assert.deepEqual(saved[0].bedroom, { floor: "upstairs", side: "back" });
    assert.equal(saved[0].exitPlan, "helper");
  });

  describe("with a helper already on file", () => {
    const DAVID: HelperOnFile = { name: "David", phone: "+14252468208", relation: "neighbor" };
    // Address, people, needs (none), care, then the exit plan: the next turn is the helper's.
    const upToExitPlan: Partial<ReadyHeard>[] = [
      { answer: "yes" },
      { answer: "yes" },
      { updates: { peopleCount: 1, pets: false } },
      { answer: "no" },
      { answer: "no" },
    ];
    async function throughExitPlan(exitPlan: Partial<ReadyHeard>, rest: Partial<ReadyHeard>[] = []) {
      const { call, saved } = readyCall([...upToExitPlan, exitPlan, ...rest], DAVID);
      call.start();
      for (let turn = 0; turn < upToExitPlan.length; turn++) await call.hear("…");
      return { call, saved, asked: spoken(await call.hear("…")) };
    }

    it("confirms them by name and number instead of asking again, and keeps them", async () => {
      const { call, saved, asked } = await throughExitPlan({ updates: { exitPlan: "helper" } }, [{ answer: "yes" }, { answer: "no" }, { answer: "yes" }]);
      assert.match(asked, /We have David at 4 2 5, 2 4 6, 8 2 0 8 down to pick you up\. Is that still right\?/);
      while (!call.done) await call.hear("…");
      assert.deepEqual(saved[0].helper, DAVID);
    });

    it("keeps them when the resident names them again without the number", async () => {
      const { asked } = await throughExitPlan({ updates: { exitPlan: "helper", helperName: "David Wu" } });
      assert.match(asked, /We have David Wu at 4 2 5/);
    });

    it("asks for the number of someone new instead of reading the old helper's", async () => {
      const { asked } = await throughExitPlan({ updates: { exitPlan: "helper", helperName: "Rosa" } });
      assert.match(asked, /What's Rosa's phone number\?/);
    });

    it("asks for the number again when the resident says the one on file is wrong", async () => {
      const { call, asked } = await throughExitPlan({ updates: { exitPlan: "helper" } }, [{ answer: "no" }]);
      assert.match(asked, /We have David/);
      assert.match(spoken(await call.hear("no, that's wrong")), /What's David's phone number\?/);
    });

    it("drops them when the resident now needs a ride from us", async () => {
      const { call, saved } = await throughExitPlan({ updates: { exitPlan: "needs_ride" } }, [{ answer: "no" }, { answer: "yes" }]);
      while (!call.done) await call.hear("…");
      assert.equal(saved[0].exitPlan, "needs_ride");
      assert.equal(saved[0].helper, undefined);
    });
  });

  it("ends without saving or counting a miss when now isn't a good time", async () => {
    const { call, saved } = readyCall([{ answer: "no" }]);
    call.start();
    assert.equal((await call.hear("not now")).done, true);
    call.lineClosed();
    assert.equal(saved.length, 0);
  });

  it("saves a partial profile on hang-up only once the exit plan is known", async () => {
    const early = readyCall([{ answer: "yes" }, { answer: "yes" }]);
    early.call.start();
    await early.call.hear("sure");
    await early.call.hear("yes");
    early.call.lineClosed();
    assert.equal(early.saved.length, 0);

    const late = readyCall([{ answer: "yes" }, { answer: "yes" }, { updates: { peopleCount: 1 } }, { answer: "no" }, { answer: "no" }, { updates: { exitPlan: "own_car" } }]);
    late.call.start();
    for (let turn = 0; turn < 6; turn++) await late.call.hear("…");
    late.call.lineClosed();
    assert.equal(late.saved.length, 1);
    assert.equal(late.saved[0].exitPlan, "own_car");
    assert.equal(late.saved[0].hasCar, true);
  });

  it("asks whether a wheelchair has a motor, and records a power chair on a yes", async () => {
    const { call } = readyCall([{ answer: "yes" }, { answer: "yes" }, { updates: { peopleCount: 1 } }, { updates: { mobility: "manual_wheelchair" } }, { answer: "yes" }]);
    call.start();
    for (let turn = 0; turn < 3; turn++) await call.hear("…");
    assert.match(spoken(await call.hear("I use a wheelchair")), /Is it a power wheelchair/);
    assert.equal(call.step, "chair_kind");
    await call.hear("yes");
    assert.equal(call.answers.mobility, "power_wheelchair");
    assert.equal(call.step, "assistance");
  });

  it("reads a phone number back digit by digit", () => {
    assert.equal(spokenDigits("+16265550123"), "6 2 6, 5 5 5, 0 1 2 3");
  });
});
