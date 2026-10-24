import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Conversation, Escalation } from "./conversation";
import type { Interpretation } from "./interpreter";
import { LINES } from "./script";

// The state machine on its own: each turn hands respond() what Claude would have read, so these
// run offline. Lines are compared against the English templates.

const EN = LINES.en;
const ADDRESS = "100 Terrace St";

function heard(overrides: Partial<Interpretation> = {}): Interpretation {
  return {
    updates: {},
    confidence: {},
    answer: null,
    emergency: "none",
    asksAboutRide: false,
    wantsRepeat: false,
    addressedToAgent: true,
    wantsToEnd: false,
    wantsTime: false,
    neighborAddresses: [],
    spokenLanguage: "en",
    acknowledgment: "",
    reply: "",
    ...overrides,
  };
}

function call() {
  const escalations: Escalation[] = [];
  const conversation = new Conversation({
    language: "en",
    onFile: {},
    knownAddress: ADDRESS,
    effects: { updateRecord: () => {}, escalate: (kind) => escalations.push(kind), nominate: () => {}, rideStatus: () => null },
  });
  conversation.start();
  return { conversation, escalations };
}

// An outbound call that reaches the can-leave question.
function atCanLeave() {
  const started = call();
  started.conversation.respond("yes", heard({ answer: "yes" }));
  assert.equal(started.conversation.step, "can_leave");
  return started;
}

// A resident leaving on their own, all the way to the goodbye.
function leaverAtGoodbye() {
  const { conversation } = atCanLeave();
  conversation.respond("yes we can", heard({ answer: "yes", updates: { canLeave: "yes" } }));
  conversation.respond("yes I have a car", heard({ answer: "yes", updates: { hasCar: true } }));
  conversation.respond("that's right", heard({ answer: "yes" }));
  const goodbye = conversation.respond("no", heard({ answer: "no" }));
  assert.ok(conversation.done);
  assert.equal(goodbye.sentences.at(-1), EN.goodbye);
  return conversation;
}

describe("answers that don't answer", () => {
  it("asks again in other words instead of repeating the question", () => {
    const { conversation } = call();
    const turn = conversation.respond("hmm", heard({ answer: "unclear" }));
    assert.equal(turn.sentences.at(-1), EN.askAgain.confirmAddress(ADDRESS));
    assert.notEqual(turn.sentences.at(-1), EN.confirmAddress(ADDRESS));
  });

  it("answers the resident's own question, then asks again, without using up a try", () => {
    const { conversation, escalations } = atCanLeave();
    const reply = "It helps us match the right vehicle to your needs.";
    for (let turn = 0; turn < 4; turn += 1) {
      const said = conversation.respond("why do you need to know?", heard({ reply }));
      assert.deepEqual(said.sentences, [reply, EN.askAgain.canLeave]);
      assert.equal(conversation.step, "can_leave");
    }
    assert.deepEqual(escalations, []);
  });

  it("waits when the resident asks for a moment", () => {
    const { conversation } = atCanLeave();
    const turn = conversation.respond("hold on, let me ask my wife", heard({ wantsTime: true }));
    assert.deepEqual(turn.sentences, [EN.takeYourTime]);
    assert.equal(turn.givesTime, true);
    assert.equal(conversation.step, "can_leave");
  });

  it("drops a reply that sounds like a promise", () => {
    const { conversation } = atCanLeave();
    const turn = conversation.respond("is someone coming?", heard({ reply: "Don't worry, a driver is on the way." }));
    assert.ok(!turn.sentences.some((line) => /driver is on the way/.test(line)));
    assert.equal(turn.guardBlocked, true);
  });

  it("still repeats the question word for word when asked to", () => {
    const { conversation } = atCanLeave();
    const turn = conversation.respond("what?", heard({ wantsRepeat: true }));
    assert.equal(turn.sentences.at(-1), EN.askCanLeave);
  });
});

describe("a quiet line", () => {
  it("checks in twice with the question in other words, then ends without counting as answered", () => {
    const { conversation } = atCanLeave();
    assert.deepEqual(conversation.checkIn().sentences, [EN.stillThere[0], EN.askAgain.canLeave]);
    assert.deepEqual(conversation.checkIn().sentences, [EN.stillThere[1], EN.askAgain.canLeave]);
    const last = conversation.checkIn();
    assert.ok(last.sentences[0].startsWith(EN.lostYou));
    assert.ok(last.done);
    assert.equal(conversation.lostContact, true);
  });

  it("starts the count again once the resident speaks", () => {
    const { conversation } = atCanLeave();
    conversation.checkIn();
    conversation.checkIn();
    conversation.respond("sorry, yes, we can all leave", heard({ answer: "yes", updates: { canLeave: "yes" } }));
    assert.deepEqual(conversation.checkIn().sentences, [EN.stillThere[0], EN.askAgain.hasCar]);
  });

  it("takes quiet at the neighbor question as nobody to name", () => {
    const { conversation } = atCanLeave();
    conversation.respond("yes", heard({ answer: "yes", updates: { canLeave: "yes" } }));
    conversation.respond("yes", heard({ answer: "yes", updates: { hasCar: true } }));
    conversation.respond("yes", heard({ answer: "yes" }));
    assert.equal(conversation.step, "neighbor");
    assert.ok(conversation.checkIn().done);
    assert.equal(conversation.lostContact, false);
  });
});

describe("the end of the call", () => {
  it("asks for the neighbor's address once when the resident only says yes", () => {
    const { conversation } = atCanLeave();
    conversation.respond("yes", heard({ answer: "yes", updates: { canLeave: "yes" } }));
    conversation.respond("yes", heard({ answer: "yes", updates: { hasCar: true } }));
    conversation.respond("yes", heard({ answer: "yes" }));
    const turn = conversation.respond("yes, there is", heard({ answer: "yes" }));
    assert.equal(conversation.step, "neighbor");
    assert.equal(turn.sentences.at(-1), EN.askAgain.neighbor);
  });

  it("reopens the call for a correction made after the goodbye", () => {
    const conversation = leaverAtGoodbye();
    const turn = conversation.respond(
      "wait, my mother is here and she uses a wheelchair",
      heard({ updates: { peopleCount: 2, mobility: "manual_wheelchair" } }),
    );
    assert.ok(!conversation.done);
    assert.equal(conversation.step, "assistance");
    assert.deepEqual(turn.sentences, [EN.readbackFixed, EN.askAssistance]);
  });

  it("reopens at the read-back on \"hold on\" after the goodbye", () => {
    const conversation = leaverAtGoodbye();
    conversation.respond("hold on", heard({ wantsTime: true }));
    assert.equal(conversation.step, "readback");
  });

  it("says nothing more to \"okay, bye\" after the goodbye", () => {
    const conversation = leaverAtGoodbye();
    const turn = conversation.respond("okay bye", heard({ wantsToEnd: true }));
    assert.deepEqual(turn.sentences, []);
    assert.ok(turn.done);
  });
});
