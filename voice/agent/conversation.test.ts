import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Conversation, Escalation } from "./conversation";
import type { Interpretation } from "./interpreter";
import { Language, LINES } from "./script";

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
    asksWhatToDo: false,
    policyQuestion: "",
    neighborAddresses: [],
    spokenLanguage: "en",
    acknowledgment: "",
    feeling: "",
    reply: "",
    ...overrides,
  };
}

// null: an inbound call from a number we have no address for.
function call(knownAddress: string | null = ADDRESS, language: Language = "en") {
  const escalations: Escalation[] = [];
  const conversation = new Conversation({
    language,
    onFile: {},
    knownAddress: knownAddress ?? undefined,
    effects: { updateRecord: () => {}, escalate: (kind) => escalations.push(kind), nominate: () => {}, rideStatus: () => null },
  });
  conversation.start();
  return { conversation, escalations };
}

// An outbound call that reaches the can-leave question.
function atCanLeave(language: Language = "en") {
  const started = call(ADDRESS, language);
  started.conversation.respond("yes", heard({ answer: "yes", spokenLanguage: language }));
  assert.equal(started.conversation.step, "can_leave");
  return started;
}

// A resident who can't leave, through the questions to waiting on hold for a driver.
function atHold(language: Language = "en") {
  const started = atCanLeave(language);
  const { conversation } = started;
  const said = (overrides: Partial<Interpretation>) => heard({ spokenLanguage: language, ...overrides });
  conversation.respond("no", said({ answer: "no", updates: { canLeave: "no" } }));
  conversation.respond("just me", said({ updates: { peopleCount: 1 } }));
  conversation.respond("I use a walker", said({ updates: { mobility: "walker" } }));
  conversation.respond("no help needed", said({ answer: "no", updates: { assistanceRequired: "none" } }));
  conversation.respond("yes", said({ answer: "yes" }));
  conversation.respond("no", said({ answer: "no" }));
  assert.equal(conversation.step, "hold");
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
    // The rephrasing and the question as first put take turns, so neither is said twice in a row.
    for (const question of [EN.askAgain.canLeave, EN.askCanLeave]) {
      const said = conversation.respond("why do you need to know?", heard({ reply }));
      assert.deepEqual(said.sentences, [reply, question]);
      assert.equal(conversation.step, "can_leave");
    }
    assert.deepEqual(escalations, []);
  });

  // The exam's eaton-mitchell call asked the neighbor question ten times this way.
  it("moves on once a held question has been held twice, so a missed answer can't loop the call", () => {
    const { conversation } = atCanLeave();
    const reply = "Your son comes first.";
    for (let turn = 0; turn < 3; turn += 1) conversation.respond("I just need help getting my son out", heard({ reply }));
    assert.equal(conversation.step, "can_leave");
    const fourth = conversation.respond("I just need help getting my son out", heard({ reply }));
    assert.equal(conversation.step, "household");
    assert.deepEqual(fourth.sentences, [reply, EN.askHousehold]);
  });

  it("answers anything said on hold with where the ride stands, never a stock filler", () => {
    const { conversation } = atHold();
    // They heard the status on reaching hold, so the first answer is something to do meanwhile.
    const asked = conversation.respond("are we supposed to wait here?", heard());
    assert.deepEqual(asked.sentences, [EN.holdSteps[0]]);
    const quiet = conversation.respond("okay", heard({ addressedToAgent: true }));
    assert.deepEqual(quiet.sentences, []);
    // The full status was said on reaching hold, two agent turns ago, so the question gets its start.
    const blocked = conversation.respond("are they coming?", heard({ reply: "They'll be there soon." }));
    assert.deepEqual(blocked.sentences, [conversation.rideAnswer()]);
    conversation.respond("how close is the fire?", heard({ reply: "I don't know that." }));
    conversation.respond("is my street closed?", heard({ reply: "I don't know whether streets are closed." }));
    const later = conversation.respond("are they coming yet?", heard({ reply: "They'll be there soon." }));
    assert.deepEqual(later.sentences, [conversation.rideLine()]);
  });

  it("never leaves a caller on hold with only an acknowledgment, or a reply it already gave", () => {
    const { conversation } = atHold();
    const acked = conversation.respond("I'll be sitting right here by the door", heard({ acknowledgment: "You're by the door." }));
    assert.deepEqual(acked.sentences, [EN.holdSteps[0]]);
    const reply = "I don't know that.";
    conversation.respond("how close is the fire?", heard({ reply }));
    const again = conversation.respond("are the roads open?", heard({ reply }));
    assert.ok(again.sentences.length > 0);
    assert.ok(!again.sentences.includes(reply));
  });

  it("answers what to do while waiting with the fixed steps, in turn", () => {
    const { conversation } = atHold();
    const first = conversation.respond("what should I bring?", heard({ asksWhatToDo: true }));
    assert.deepEqual(first.sentences, [EN.holdSteps[0]]);
    const second = conversation.respond("anything else I should do?", heard({ asksWhatToDo: true }));
    assert.deepEqual(second.sentences, [EN.holdSteps[1]]);
  });

  it("tells someone leaving on their own to go when they ask what to do", () => {
    const { conversation } = atCanLeave();
    conversation.respond("yes", heard({ answer: "yes", updates: { canLeave: "yes" } }));
    const turn = conversation.respond("what should I do?", heard({ asksWhatToDo: true }));
    assert.ok(turn.sentences.includes(EN.leaveNow));
  });

  it("fills a quiet line on hold with steps, then check-ins, then a goodbye", () => {
    const { conversation } = atHold();
    const said = Array.from({ length: 6 }, () => conversation.checkIn().sentences);
    assert.deepEqual(said.slice(0, 3), EN.holdSteps.map((step) => [step]));
    assert.deepEqual(said.slice(3), EN.stillThere.map((line) => [line]));
    assert.equal(conversation.step, "hold");
    const last = conversation.checkIn();
    assert.ok(last.done);
    assert.ok(last.sentences.includes(EN.goodbye));
  });

  it("starts the quiet count over when the caller on hold speaks", () => {
    const { conversation } = atHold();
    for (let stretch = 0; stretch < 6; stretch += 1) conversation.checkIn();
    conversation.respond("okay", heard());
    assert.ok(!conversation.checkIn().done);
  });

  it("takes a correction that restates the record as a confirmation, not a loop", () => {
    const fresh = atCanLeave().conversation;
    fresh.respond("no", heard({ answer: "no", updates: { canLeave: "no" } }));
    fresh.respond("just me", heard({ updates: { peopleCount: 1 } }));
    fresh.respond("bedbound", heard({ updates: { mobility: "bedbound" } }));
    fresh.respond("two to lift", heard({ updates: { assistanceRequired: "two_person_lift" } }));
    assert.equal(fresh.step, "readback");
    fresh.respond("No. It takes two people to lift him.", heard({ answer: "no", updates: { assistanceRequired: "two_person_lift" } }));
    assert.equal(fresh.step, "neighbor");
  });

  it("never lets \"I won't leave without my son\" turn a recorded no into unsure", () => {
    const { conversation } = atCanLeave();
    conversation.respond("no, I can't get out", heard({ answer: "no", updates: { canLeave: "no" } }));
    conversation.respond("I'm not leaving without my son", heard({ updates: { canLeave: "unsure" } }));
    assert.equal(conversation.record.canLeave, "no");
  });

  it("takes \"I don't know\" to the can-leave question as unsure", () => {
    const { conversation } = atCanLeave();
    conversation.respond("I don't know. There's four of us left here.", heard({ answer: "unclear", updates: { peopleCount: 4 } }));
    assert.equal(conversation.record.canLeave, "unsure");
  });

  it("never says nothing has changed before any status was given", () => {
    const { conversation } = atCanLeave();
    conversation.respond("yes, we're leaving", heard({ answer: "yes", updates: { canLeave: "yes" }, asksAboutRide: true }));
    const again = conversation.respond("yes we have the car", heard({ answer: "yes", updates: { hasCar: true }, asksAboutRide: true }));
    assert.ok(!again.sentences.includes(EN.statusUnchanged));
  });

  it("takes an address given at the address question as the household's, even filed as a neighbor", () => {
    const { conversation } = call(null);
    conversation.respond("I'm in the car. He's at our house, 3037 Ewing Street.", heard({ neighborAddresses: ["3037 Ewing Street"] }));
    assert.equal(conversation.record.address, "3037 Ewing Street");
    assert.equal(conversation.step, "confirm_address");
  });

  it("passes on a neighbor named on two turns once", () => {
    const nominations: string[] = [];
    const conversation = new Conversation({
      language: "en",
      onFile: {},
      knownAddress: ADDRESS,
      effects: { updateRecord: () => {}, escalate: () => {}, nominate: (place) => nominations.push(place), rideStatus: () => null },
    });
    conversation.start();
    const first = conversation.respond("the lady at 45 East Mariposa", heard({ neighborAddresses: ["45 East Mariposa"] }));
    conversation.respond("yes, 45 East Mariposa", heard({ neighborAddresses: ["45 East Mariposa"] }));
    assert.deepEqual(nominations, ["45 East Mariposa"]);
    assert.ok(first.sentences.includes(EN.passedOn("45 East Mariposa")));
  });

  // Jerry's call: "I don't know the address, but I know Boris is also bedridden." Boris is on file.
  function atNeighbor() {
    const nominations: { place: string; danger?: boolean }[] = [];
    const conversation = new Conversation({
      language: "en",
      onFile: {},
      knownAddress: ADDRESS,
      neighborNames: ["Boris Nezlobin", "Brendan Giang"],
      effects: { updateRecord: () => {}, escalate: () => {}, nominate: (place, danger) => nominations.push({ place, danger }), rideStatus: () => null },
    });
    conversation.start();
    conversation.respond("yes", heard({ answer: "yes" }));
    conversation.respond("yes we can", heard({ answer: "yes", updates: { canLeave: "yes" } }));
    conversation.respond("yes I have a car", heard({ answer: "yes", updates: { hasCar: true } }));
    conversation.respond("that's right", heard({ answer: "yes" }));
    assert.equal(conversation.step, "neighbor");
    return { conversation, nominations };
  }

  it("finds a neighbor named without an address on file, and doesn't ask for the address", () => {
    const { conversation, nominations } = atNeighbor();
    const turn = conversation.respond("I don't know the address, but Boris is bedridden", heard({ answer: "yes", neighborAddresses: ["Boris, bedridden"] }));
    assert.deepEqual(nominations, [{ place: "Boris, bedridden", danger: false }]);
    assert.ok(turn.sentences.includes(EN.passedOn("Boris Nezlobin")));
    assert.notEqual(conversation.step, "neighbor");
  });

  // Jerry's call: "Thanks, Boris up the stream. Thanks, I've passed on Boris Nezlobin."
  it("says one thanks for a neighbor passed on, not Claude's acknowledgment as well", () => {
    const { conversation } = atNeighbor();
    const turn = conversation.respond(
      "I think up the stream, Boris is bedridden right now",
      heard({ neighborAddresses: ["Boris, bedridden"], acknowledgment: "Thanks, Boris up the stream." }),
    );
    assert.equal(turn.acknowledgment, "");
    assert.ok(turn.sentences.includes(EN.passedOn("Boris Nezlobin")));
  });

  it("passes on someone down the road who is dying as urgent, without an address", () => {
    const { conversation, nominations } = atNeighbor();
    const turn = conversation.respond(
      "a guy down the road chugged five bottles and is dying",
      heard({ answer: "yes", neighborAddresses: ["a man down the road"], neighborInDanger: true }),
    );
    assert.deepEqual(nominations, [{ place: "a man down the road", danger: true }]);
    assert.ok(turn.sentences.includes(EN.neighborUrgent));
    assert.notEqual(conversation.step, "neighbor");
  });

  it("passes a neighbor on again when they turn out to be in danger", () => {
    const { conversation, nominations } = atNeighbor();
    conversation.respond("Boris is bedridden", heard({ answer: "yes", neighborAddresses: ["Boris"] }));
    conversation.respond("he's actively dying", heard({ neighborAddresses: ["Boris"], neighborInDanger: true }));
    assert.deepEqual(nominations, [{ place: "Boris", danger: false }, { place: "Boris", danger: true }]);
  });

  it("stays on the line for a plain \"okay\" on hold, and ends only on a goodbye", () => {
    const { conversation } = atHold();
    conversation.respond("Okay.", heard({ wantsToEnd: true }));
    assert.equal(conversation.step, "hold");
    conversation.respond("Okay, bye.", heard({ wantsToEnd: true }));
    assert.ok(conversation.done);
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

describe("a quiet line on a live call", () => {
  it("ends without a word and counts as lost contact before the readback", () => {
    const { conversation, escalations } = call(null);
    conversation.lineWentQuiet();
    assert.ok(conversation.done);
    assert.equal(conversation.lostContact, true);
    assert.deepEqual(escalations, ["address_unconfirmed"]);
  });

  it("ends as answered when the resident was already on hold for a driver", () => {
    const { conversation } = atHold();
    conversation.lineWentQuiet();
    assert.ok(conversation.done);
    assert.equal(conversation.lostContact, false);
  });
});

describe("a quiet line", () => {
  it("checks in twice with the question in other words, then ends without counting as answered", () => {
    const { conversation } = atCanLeave();
    assert.deepEqual(conversation.checkIn().sentences, [EN.stillThere[0], EN.askAgain.canLeave]);
    assert.deepEqual(conversation.checkIn().sentences, [EN.stillThere[1], EN.askCanLeave]);
    const last = conversation.checkIn();
    assert.ok(last.sentences[0].startsWith(EN.lostYou));
    assert.ok(last.done);
    assert.equal(conversation.lostContact, true);
  });

  it("flags a lost caller who never gave an address for a dispatcher", () => {
    const { conversation, escalations } = call(null);
    for (let check = 0; check <= 2; check += 1) conversation.checkIn();
    assert.equal(conversation.lostContact, true);
    assert.deepEqual(escalations, ["address_unconfirmed"]);
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
    assert.equal(conversation.step, "chair_kind");
    assert.deepEqual(turn.sentences, [EN.readbackFixed, EN.askChairKind]);
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

describe("an address that never gets confirmed", () => {
  // Answers that aren't an address, until the agent gives up and moves on to the next question.
  function untilGivenUp(conversation: Conversation, answer: Interpretation) {
    const said: string[] = [];
    while (conversation.step === "ask_address" || conversation.step === "confirm_address") {
      said.push(...conversation.respond("thanks", answer).sentences);
    }
    return said;
  }

  it("says the address is flagged when one is on file", () => {
    const { conversation, escalations } = call();
    const said = untilGivenUp(conversation, heard());
    assert.ok(said.includes(EN.addressEscalated));
    assert.ok(!said.includes(EN.addressMissing));
    assert.deepEqual(escalations, ["address_unconfirmed"]);
  });

  it("never claims an address when none was heard", () => {
    const { conversation, escalations } = call(null);
    const said = untilGivenUp(conversation, heard());
    assert.ok(said.includes(EN.addressMissing));
    assert.ok(!said.includes(EN.addressEscalated));
    assert.deepEqual(escalations, ["address_unconfirmed"]);
  });
});

describe("what the agent says it heard", () => {
  it("echoes the facts an answer gave instead of Claude's acknowledgment", () => {
    const { conversation } = atCanLeave();
    conversation.respond("no, I can't", heard({ answer: "no", updates: { canLeave: "no" } }));
    const turn = conversation.respond("two of us and a dog", heard({ updates: { peopleCount: 2, pets: true }, acknowledgment: "Okay." }));
    assert.equal(turn.acknowledgment, `${EN.people(2)}, ${EN.pets}.`.replace(/^./, (first) => first.toUpperCase()));
    assert.equal(turn.acknowledgmentIsEcho, true);
  });

  it("falls back to Claude's acknowledgment when no fact changed", () => {
    const { conversation } = call();
    const turn = conversation.respond("yes", heard({ answer: "yes", acknowledgment: "Alright, that's the address." }));
    assert.equal(turn.acknowledgment, "Alright, that's the address.");
    assert.ok(!turn.acknowledgmentIsEcho);
  });
});

describe("a turn reheard in another language", () => {
  it("switches to the language the rehearing heard and keeps what the resident actually said", () => {
    const { conversation } = call();
    const turn = conversation.respond("What she would shout, Jonguen.", heard({ spokenLanguage: "zh", heardAs: "我只会说中文" }));
    assert.equal(turn.heardAs, "我只会说中文");
    assert.equal(conversation.language, "zh");
    // The hand-over line is said in the language the call leaves.
    assert.equal(turn.transfer?.language, "en");
  });
});

describe("nobody can understand each other", () => {
  it("says a person was told, once in the call language and once in English, and never promises a transfer", () => {
    const conversation = new Conversation({
      language: "es",
      onFile: {},
      knownAddress: ADDRESS,
      effects: { updateRecord: () => {}, escalate: () => {}, nominate: () => {}, rideStatus: () => null },
    });
    conversation.start();
    const turn = conversation.respond("Բարեւ", heard({ spokenLanguage: "hy" }));
    assert.ok(turn.done);
    assert.equal(turn.sentences.length, 2);
    assert.ok(turn.sentences[0].startsWith(LINES.es.languageBarrier));
    assert.ok(turn.sentences[1].startsWith(EN.languageBarrier));
    assert.ok(!/passing|transfer/i.test(turn.sentences.join(" ")));
  });
});

// From the Palo Alto Fire visit: "you said wheelchair, I thought wheelchair. And then you get there,
// and it's a battery-operated wheelchair, and they're 400 pounds."
describe("which kind of wheelchair", () => {
  function atNeeds() {
    const started = atCanLeave();
    started.conversation.respond("no", heard({ answer: "no", updates: { canLeave: "no" } }));
    started.conversation.respond("just me", heard({ updates: { peopleCount: 1 } }));
    assert.equal(started.conversation.step, "needs");
    return started;
  }

  it("asks whether a wheelchair has a motor when the resident didn't say", () => {
    const { conversation } = atNeeds();
    const turn = conversation.respond("I use a wheelchair", heard({ updates: { mobility: "manual_wheelchair" } }));
    assert.equal(conversation.step, "chair_kind");
    assert.equal(turn.sentences.at(-1), EN.askChairKind);
  });

  it("records a power chair on a yes, then asks how much help", () => {
    const { conversation } = atNeeds();
    conversation.respond("I use a wheelchair", heard({ updates: { mobility: "manual_wheelchair" } }));
    conversation.respond("yes", heard({ answer: "yes" }));
    assert.equal(conversation.record.mobility, "power_wheelchair");
    assert.equal(conversation.step, "assistance");
  });

  it("keeps a manual chair on a no", () => {
    const { conversation } = atNeeds();
    conversation.respond("I use a wheelchair", heard({ updates: { mobility: "manual_wheelchair" } }));
    conversation.respond("no", heard({ answer: "no" }));
    assert.equal(conversation.record.mobility, "manual_wheelchair");
    assert.equal(conversation.step, "assistance");
  });

  it("doesn't ask when the resident already said which kind", () => {
    const { conversation } = atNeeds();
    conversation.respond("my wife pushes my wheelchair", heard({ updates: { mobility: "manual_wheelchair" }, saysChairKind: true }));
    assert.equal(conversation.step, "assistance");
  });

  it("moves on after two unclear answers instead of holding the call", () => {
    const { conversation } = atNeeds();
    conversation.respond("I use a wheelchair", heard({ updates: { mobility: "manual_wheelchair" } }));
    conversation.respond("what?", heard({ answer: "unclear" }));
    assert.equal(conversation.step, "chair_kind");
    conversation.respond("hmm", heard({ answer: "unclear" }));
    assert.equal(conversation.step, "assistance");
  });
});

// Each case is a line real callers heard over and over on robust-penguin-834, 2026-10-24.
describe("lines the caller just heard", () => {
  it("answers a second ride question with where it stands instead of the whole status again", () => {
    const { conversation } = atHold();
    const full = conversation.rideLine();
    // Straight after the full status, a question still hears where the ride stands, not "Nothing has
    // changed": the voice exam's reassigned caller never heard that the driver can't reach them.
    const right = conversation.respond("when are you getting here?", heard({ asksAboutRide: true }));
    assert.deepEqual(right.sentences, [conversation.rideAnswer()]);
    conversation.respond("okay, let me get my bag", heard());
    const asked = conversation.respond("when are you getting here?", heard({ asksAboutRide: true }));
    assert.deepEqual(asked.sentences, [conversation.rideAnswer()]);
    // No request exists in this test, so nothing claims one was placed.
    assert.ok(conversation.rideAnswer().includes("No driver has accepted yet."));
    assert.ok(!conversation.rideAnswer().includes("I've placed"));
    // Asked again straight after that answer, the news is that nothing changed.
    const again = conversation.respond("so when?", heard({ asksAboutRide: true }));
    assert.deepEqual(again.sentences, [EN.statusUnchanged]);
    const repeat = conversation.respond("say that again?", heard({ wantsRepeat: true }));
    assert.ok(repeat.sentences.includes(full));
  });

  it("re-asks the open question after one status change, not after every one", () => {
    const { conversation } = atCanLeave();
    conversation.respond("no", heard({ answer: "no", updates: { canLeave: "no" } }));
    const first = conversation.announce("Grace is driving to you now.");
    assert.deepEqual(first.sentences, ["Grace is driving to you now.", EN.askHousehold]);
    const second = conversation.announce("Howard is driving to you now.");
    assert.deepEqual(second.sentences, ["Howard is driving to you now."]);
    conversation.respond("five of us", heard({ updates: { peopleCount: 5 } }));
    const third = conversation.announce("Your driver is at your home now.");
    assert.equal(third.sentences.length, 2);
  });

  it("drops a reply that only rewords one already given, and says nothing to a bare 'oh'", () => {
    const { conversation } = atHold();
    const reply = "I don't know who Paulina is from this call.";
    const asked = conversation.respond("Where's Paulina?", heard({ reply }));
    assert.ok(asked.sentences.includes(reply));
    const oh = conversation.respond("Oh,", heard({ reply: "I don't know who Paulina is either." }));
    assert.deepEqual(oh.sentences, []);
    const other = conversation.respond("Who is Howard?", heard({ reply: "I don't know who Howard is." }));
    assert.ok(other.sentences.includes("I don't know who Howard is."));
  });

  // Jerry at 3060 Olive Avenue asked "Can anyone help me?" and "Am I in heaven?" on hold and heard
  // "Nothing has changed since I last told you." both times.
  it("answers a question on hold instead of saying its last line again", () => {
    const { conversation } = atHold();
    conversation.respond("okay, let me turn it on", heard());
    const help = conversation.respond("Can anyone help me?", heard({ asksAboutRide: true }));
    assert.deepEqual(help.sentences, [conversation.rideAnswer()]);
    const heaven = conversation.respond("Am I in heaven?", heard({ reply: "No, you're on the phone with 911." }));
    assert.deepEqual(heaven.sentences, ["No, you're on the phone with 911."]);
  });

  // Jerry's test call, 05:18: "Hello?" twice on hold, each answered with the five-sentence status
  // the agent had just said, and the hold prompt said twice.
  it("answers 'Hello?' on hold that it is still on the line, not with the status again", () => {
    const { conversation } = atHold();
    const full = conversation.rideLine();
    const hello = conversation.respond("Hello?", heard({ wantsRepeat: true }));
    assert.deepEqual(hello.sentences, [EN.stillThere[1]]);
    const again = conversation.respond("Can you say that again?", heard({ wantsRepeat: true }));
    assert.ok(again.sentences.includes(full));
    const said = [hello, again].flatMap((turn) => turn.sentences);
    assert.ok(!said.includes(EN.holdPrompt));
  });

  it("gives the same answer to a new question, but not to the line it just answered", () => {
    const { conversation } = atHold();
    const unknown = "I don't know that.";
    assert.ok(conversation.respond("How close is the fire?", heard({ reply: unknown })).sentences.includes(unknown));
    const second = conversation.respond("Which roads are closed?", heard({ reply: unknown }));
    assert.ok(!second.sentences.includes(unknown));
    conversation.respond("okay, let me get my bag", heard());
    assert.ok(conversation.respond("Is it windy there?", heard({ reply: unknown })).sentences.includes(unknown));
  });

  it("answers a Chinese caller on hold who says more than 嗯 or 好的", () => {
    const { conversation } = atHold("zh");
    const zh = (overrides: Partial<Interpretation> = {}) => heard({ spokenLanguage: "zh", ...overrides });
    assert.deepEqual(conversation.respond("嗯", zh()).sentences, []);
    assert.ok(conversation.respond("我会死吗", zh()).sentences.length > 0);
    assert.ok(conversation.respond("说话呀", zh()).sentences.length > 0);
  });

  it("says no change on reaching hold when a status change played three turns earlier", () => {
    const { conversation } = atCanLeave();
    conversation.respond("no", heard({ answer: "no", updates: { canLeave: "no" } }));
    conversation.respond("just me", heard({ updates: { peopleCount: 1 } }));
    conversation.respond("I use a walker", heard({ updates: { mobility: "walker" } }));
    conversation.respond("no help needed", heard({ answer: "no", updates: { assistanceRequired: "none" } }));
    conversation.announce(conversation.rideLine());
    conversation.respond("hold on", heard({ wantsTime: true }));
    conversation.respond("yes", heard({ answer: "yes" }));
    const hold = conversation.respond("no", heard({ answer: "no" }));
    assert.equal(conversation.step, "hold");
    assert.ok(hold.sentences.includes(EN.statusUnchanged));
    assert.ok(!hold.sentences.includes(conversation.rideLine()));
  });

  it("never answers a life threat on hold with no change, and says the full status once it isn't fresh", () => {
    const { conversation } = atHold();
    const soon = conversation.respond("I can see the fire approaching. I'm about to die.", heard({ emergency: "flames", asksAboutRide: true }));
    assert.ok(!soon.sentences.includes(EN.statusUnchanged));
    assert.ok(!soon.sentences.includes(conversation.rideLine()));
    conversation.respond("how close is the fire?", heard({ reply: "I don't know that." }));
    conversation.respond("is my street closed?", heard({ reply: "I don't know whether streets are closed." }));
    const later = conversation.respond("I'm burning, I'm burning.", heard({ emergency: "flames" }));
    assert.ok(later.sentences.includes(conversation.rideLine()));
  });

  // Jerry at 3060 Olive Avenue: seven full status lines and five "Nothing has changed" in six minutes.
  it("keeps a panicking caller on hold from hearing the status every turn", () => {
    const { conversation } = atHold();
    const turns: [string, Partial<Interpretation>][] = [
      ["Oh my god, I don't want to die.", { emergency: "flames" }],
      ["I can see the fire outside.", { emergency: "flames" }],
      ["I can't leave safely. Give me some tips.", { asksWhatToDo: true }],
      ["All right, so I'm gonna die here.", { emergency: "flames" }],
      ["Fire has not reached my home.", {}],
      ["Okay. Let me turn it on.", {}],
      ["Can anyone help me?", { emergency: "flames", asksAboutRide: true }],
      ["Unacceptable.", { feeling: "That sounds really frustrating." }],
    ];
    const said = turns.flatMap(([words, reading]) => conversation.respond(words, heard(reading)).sentences);
    const full = said.filter((line) => line === conversation.rideLine()).length;
    const unchanged = said.filter((line) => line === EN.statusUnchanged).length;
    assert.ok(full <= 2, `full status ${full} times`);
    assert.equal(unchanged, 0);
  });
});

describe("a home with a Ready check profile on file", () => {
  // Jerry's Ready check: two people, one needs a person to help them out to the car.
  const ON_FILE = { peopleCount: 2, mobility: "walks", assistanceRequired: "one_person_assist" } as const;

  function readyHome() {
    const conversation = new Conversation({
      language: "en",
      onFile: { ...ON_FILE },
      knownAddress: ADDRESS,
      effects: { updateRecord: () => {}, escalate: () => {}, nominate: () => {}, rideStatus: () => null },
    });
    conversation.start();
    conversation.respond("yes", heard({ answer: "yes" }));
    return conversation;
  }

  const spoken = (turn: { acknowledgment: string; sentences: string[] }) => [turn.acknowledgment, ...turn.sentences].join(" ");

  it("confirms the profile in one read-back instead of asking each question again", () => {
    const conversation = readyHome();
    const turn = conversation.respond("no, I can't", heard({ answer: "no", updates: { canLeave: "no" } }));
    assert.equal(conversation.step, "readback");
    assert.match(spoken(turn), /Here's what you told us in your Ready check\. 2 people/);
    conversation.respond("yes, that's right", heard({ answer: "yes" }));
    assert.equal(conversation.step, "neighbor");
  });

  it("reads back with the usual opening once something on file has changed", () => {
    const conversation = readyHome();
    conversation.respond("no, I can't", heard({ answer: "no", updates: { canLeave: "no" } }));
    const turn = conversation.respond("there are three of us now", heard({ updates: { peopleCount: 3 } }));
    assert.doesNotMatch(spoken(turn), /Ready check/);
    assert.match(spoken(turn), /3 people/);
  });

  it("still asks what the profile doesn't say", () => {
    const conversation = new Conversation({
      language: "en",
      onFile: { peopleCount: 2 },
      knownAddress: ADDRESS,
      effects: { updateRecord: () => {}, escalate: () => {}, nominate: () => {}, rideStatus: () => null },
    });
    conversation.start();
    conversation.respond("yes", heard({ answer: "yes" }));
    conversation.respond("no", heard({ answer: "no", updates: { canLeave: "no" } }));
    assert.equal(conversation.step, "needs");
  });
});

// Goals, not a script: code picks the question, Claude may word it, and code checks the words.
describe("Claude's wording of the next question", () => {
  const household = "You can't leave on your own, alright. Who's at home with you right now, and any pets?";
  const cantLeave = (ask: Interpretation["ask"]) => heard({ answer: "no", updates: { canLeave: "no" }, ask });

  it("is spoken when Claude aimed it at the step the code lands on, with no second acknowledgment", () => {
    const { conversation } = atCanLeave();
    const turn = conversation.respond("no, I can't", cantLeave({ goal: "household", line: household }));
    assert.equal(conversation.step, "household");
    assert.deepEqual(turn.sentences, [household]);
    assert.equal(turn.acknowledgment, "");
  });

  it("falls back to the template when Claude aimed at a different goal", () => {
    const { conversation } = atCanLeave();
    const turn = conversation.respond("no, I can't", cantLeave({ goal: "needs", line: "Alright. Does anyone there use a walker or a wheelchair?" }));
    assert.equal(turn.sentences.at(-1), EN.askHousehold);
    assert.equal(turn.acknowledgment, "You can't leave on your own.");
  });

  it("drops a line that implies help is coming while no driver has accepted", () => {
    const { conversation } = atCanLeave();
    const turn = conversation.respond("no, I can't", cantLeave({ goal: "household", line: "Help is on the way. How many people are with you?" }));
    assert.equal(turn.sentences.at(-1), EN.askHousehold);
    assert.ok(!turn.sentences.some((line) => /on the way/.test(line)));
    assert.equal(turn.guardBlocked, true);
  });

  it("drops a line that also asks about another goal", () => {
    const { conversation } = atCanLeave();
    const turn = conversation.respond("no, I can't", cantLeave({ goal: "household", line: "Alright. How many of you are there, and does anyone use a wheelchair?" }));
    assert.equal(turn.sentences.at(-1), EN.askHousehold);
  });

  it("drops a line in another language than the call's", () => {
    const { conversation } = atCanLeave("es");
    const ask = { goal: "household", line: "Alright. How many people are with you right now?" };
    const turn = conversation.respond("no puedo", heard({ answer: "no", updates: { canLeave: "no" }, spokenLanguage: "es", ask }));
    assert.equal(turn.sentences.at(-1), LINES.es.askHousehold);
  });

  it("says back only the digits of the address the record holds", () => {
    const given = heard({ answer: "no", updates: { address: "2585 Catherine Road" } });
    const right = call().conversation.respond("no, I'm at 2585 Catherine Road", { ...given, ask: { goal: "confirm_address", line: "Thanks. So that's 2585 Catherine Road?" } });
    assert.deepEqual(right.sentences, ["Thanks. So that's 2585 Catherine Road?"]);
    const wrong = call().conversation.respond("no, I'm at 2585 Catherine Road", { ...given, ask: { goal: "confirm_address", line: "Thanks. So that's 2586 Catherine Road?" } });
    assert.equal(wrong.sentences.at(-1), EN.confirmAddress("2585 Catherine Road"));
  });

  it("never asks a goal again in the same words", () => {
    const { conversation } = atCanLeave();
    const turn = conversation.respond("hmm", heard({ answer: "unclear", ask: { goal: "can_leave", line: EN.askCanLeave } }));
    assert.equal(conversation.step, "can_leave");
    assert.equal(turn.sentences.at(-1), EN.askAgain.canLeave);
  });

  it("rewords a question left open by a correction to something else", () => {
    const { conversation } = atCanLeave();
    conversation.respond("no", heard({ answer: "no", updates: { canLeave: "no" } }));
    conversation.respond("me and my husband", heard({ updates: { peopleCount: 2 } }));
    const turn = conversation.respond("wait, he's not here, it's just me", heard({ updates: { peopleCount: 1 } }));
    assert.equal(conversation.step, "needs");
    assert.equal(turn.sentences.at(-1), EN.askAgain.needs);
  });

  it("takes \"nobody\" to the car question as no car", () => {
    const { conversation } = atCanLeave();
    conversation.respond("yes we can", heard({ answer: "yes", updates: { canLeave: "yes" } }));
    assert.equal(conversation.step, "has_car");
    conversation.respond("Nobody, I'd need you to come get me.", heard());
    assert.equal(conversation.record.hasCar, false);
    assert.equal(conversation.step, "household");
  });

  it("moves on at once when the resident doesn't know", () => {
    const { conversation } = atCanLeave();
    conversation.respond("no", heard({ answer: "no", updates: { canLeave: "no" } }));
    conversation.respond("I'm not sure", heard({ unsure: true }));
    assert.equal(conversation.step, "needs");
  });
});

describe("a caller with fire at the home, on hold", () => {
  it("hears the agency's fire-safety steps once when they plead or ask about the ride", () => {
    const { conversation } = atHold();
    conversation.respond("the flames are at my door", heard({ emergency: "flames" }));
    const first = conversation.respond("please, is someone coming?", heard({ asksAboutRide: true }));
    assert.ok(first.sentences.some((line) => line.startsWith("If fire blocks your way out")));
    const again = conversation.respond("please hurry", heard({ asksAboutRide: true }));
    assert.ok(!again.sentences.some((line) => line.startsWith("If fire blocks your way out")));
  });

  it("doesn't hear them without fire at the home", () => {
    const { conversation } = atHold();
    const turn = conversation.respond("is someone coming?", heard({ asksAboutRide: true }));
    assert.ok(!turn.sentences.some((line) => line.startsWith("If fire blocks your way out")));
  });
});

describe("a resident who isn't at the home", () => {
  function awayCall() {
    const updates: object[] = [];
    const conversation = new Conversation({
      language: "en",
      onFile: {},
      knownAddress: ADDRESS,
      effects: { updateRecord: (patch) => updates.push(patch), escalate: () => {}, nominate: () => {}, rideStatus: () => null },
    });
    conversation.start();
    const markedAway = () => updates.some((patch) => (patch as { away?: boolean }).away === true);
    return { conversation, markedAway };
  }

  it("is asked to confirm nobody is there, then the call ends without asking anything else", () => {
    const { conversation, markedAway } = awayCall();
    const asked = conversation.respond("no, I already left, I'm at my sister's", heard({ answer: "no", awayFromHome: true }));
    assert.ok(asked.sentences.includes(EN.confirmAway));
    assert.ok(!markedAway());
    const turn = conversation.respond("no, nobody", heard({ answer: "no" }));
    assert.ok(conversation.done);
    assert.deepEqual(turn.sentences, [EN.awaySafe, EN.goodbye]);
    assert.ok(markedAway());
  });

  // Voice exam: "I'm in the car, he's at our house" was read as nobody home and the ride called off.
  it("keeps the call going when someone turns out to be at the home", () => {
    const { conversation, markedAway } = awayCall();
    conversation.respond("I'm in the car, he's at our house", heard({ answer: "yes", awayFromHome: true }));
    const turn = conversation.respond("yes, my son is there", heard({ answer: "yes" }));
    assert.ok(!conversation.done);
    assert.ok(!markedAway());
    assert.ok(!turn.sentences.includes(EN.awaySafe));
  });

  it("doesn't ask when the same answer says someone is there", () => {
    const { conversation } = awayCall();
    const turn = conversation.respond("Just him. He's alone in the house.", heard({ awayFromHome: true, updates: { peopleCount: 1 } }));
    assert.ok(!turn.sentences.includes(EN.confirmAway));
    assert.notEqual(conversation.step, "confirm_away");
  });

  it("keeps the call going after two unclear answers to the confirming question", () => {
    const { conversation, markedAway } = awayCall();
    conversation.respond("we just walked outside", heard({ awayFromHome: true }));
    conversation.respond("what?", heard({ answer: "unclear" }));
    conversation.respond("um", heard({ answer: "unclear" }));
    assert.notEqual(conversation.step, "confirm_away");
    assert.ok(!markedAway());
  });

  it("never says the resident is safe", () => {
    assert.ok(!/\bsafe\b/i.test(EN.awaySafe));
  });

  // Jerry's call: "I'm burning", then "I don't like that answer" was read as nobody home.
  it("never ends as away after a fire at the home was raised on the call", () => {
    const { conversation } = atHold();
    conversation.respond("I see flames in front of me", heard({ emergency: "flames" }));
    const turn = conversation.respond("Okay. I don't like that answer.", heard({ awayFromHome: true }));
    assert.ok(!conversation.done);
    assert.ok(!turn.sentences.includes(EN.awaySafe));
  });
});


describe("the 911 screen on a call", () => {
  const SCREEN = { brief: "Disaster: wildfire evacuation.", fire: "Our fire map shows the fire about 1.4 miles to your northeast.", route: "The fastest way out right now is Lincoln Avenue." };
  function screened() {
    const conversation = new Conversation({
      language: "en",
      onFile: {},
      knownAddress: ADDRESS,
      effects: { updateRecord: () => {}, escalate: () => {}, nominate: () => {}, rideStatus: () => null, screen: () => SCREEN },
    });
    conversation.start();
    return conversation;
  }

  it("answers where the fire is and which way to go with the screen's lines", () => {
    const conversation = screened();
    const turn = conversation.respond("Where's the fire? Which way do I go?", heard({ asksFire: true, asksRoute: true }));
    assert.ok(turn.sentences.includes(SCREEN.fire));
    assert.ok(turn.sentences.includes(SCREEN.route));
  });

  it("tells someone leaving on their own the fastest way out", () => {
    const conversation = screened();
    conversation.respond("yes", heard({ answer: "yes", updates: { canLeave: "yes" } }));
    conversation.respond("yes I have a car", heard({ answer: "yes", updates: { hasCar: true } }));
    const turn = conversation.respond("what should I do?", heard({ asksWhatToDo: true }));
    assert.ok(turn.sentences.includes(SCREEN.route));
  });
});
