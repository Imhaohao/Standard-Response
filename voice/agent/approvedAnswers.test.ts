import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvedAnswerDocuments } from "./answerLookup";
import { APPROVED_ANSWER_IDS, APPROVED_ANSWERS, ApprovedAnswerId, ApprovedMatch, mayGetApprovedAnswer, withApprovedAnswer } from "./approvedAnswers";
import { guardAcknowledgment } from "./honesty";
import type { Interpretation } from "./interpreter";

const DOG: ApprovedMatch = { id: "pets", score: 0.9, lookupMs: 3 };

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

describe("approved answers", () => {
  it("never sound like a promise of a ride, before any driver has accepted", () => {
    for (const id of APPROVED_ANSWER_IDS) {
      for (const [language, text] of Object.entries(APPROVED_ANSWERS[id].answer)) {
        const guarded = guardAcknowledgment(text, "none", language as "en" | "es", true);
        assert.equal(guarded.blocked, false, `${id} (${language}) is blocked by the honesty guard: ${text}`);
      }
    }
  });

  it("index every phrasing once, tagged with its answer", () => {
    const documents = approvedAnswerDocuments();
    assert.equal(new Set(documents.map((document) => document.id)).size, documents.length);
    assert.ok(documents.every((document) => APPROVED_ANSWER_IDS.includes(document.metadata?.answer as never)));
  });

  it("replace Claude's reply when Claude heard a policy question", () => {
    const turn = withApprovedAnswer(heard({ policyQuestion: "Can I bring my dog?", reply: "I don't know that." }), DOG);
    assert.equal(turn.reply, APPROVED_ANSWERS.pets.answer.en);
    assert.equal(turn.approvedAnswer, DOG);
  });

  it("answer in the language the resident is speaking", () => {
    const turn = withApprovedAnswer(heard({ policyQuestion: "Can I bring my dog?", spokenLanguage: "es" }), DOG);
    assert.equal(turn.reply, APPROVED_ANSWERS.pets.answer.es);
  });

  it("leave the turn alone when it isn't a policy question", () => {
    const original = heard({ reply: "It helps us match the right vehicle." });
    assert.equal(withApprovedAnswer(original, DOG), original);
  });

  it("leave Claude's reply when there's no match, or no answer in that language", () => {
    const unmatched = heard({ policyQuestion: "Can I bring my dog?", reply: "I don't know that." });
    assert.equal(withApprovedAnswer(unmatched, null), unmatched);
    const korean = heard({ policyQuestion: "Can I bring my dog?", spokenLanguage: "ko", reply: "모르겠습니다." });
    assert.equal(withApprovedAnswer(korean, DOG), korean);
  });

  it("take the place of the fixed what-to-do step", () => {
    const turn = withApprovedAnswer(heard({ policyQuestion: "Can I bring my dog?", asksWhatToDo: true }), DOG);
    assert.equal(turn.asksWhatToDo, false);
  });

  it("never open with a yes that could answer a different question", () => {
    for (const id of APPROVED_ANSWER_IDS) {
      for (const [language, text] of Object.entries(APPROVED_ANSWERS[id].answer)) {
        assert.doesNotMatch(text, /^(yes|sí|si)\b/i, `${id} (${language}) opens with a yes: ${text}`);
      }
    }
  });

  // Questions the unsafe advice set heard answered from the bank,
  // as Claude restates them, plus going back for a neighbor (Palo Alto Station 6), and the safety
  // answer each may get. Staying or waiting gets none: the ride status line answers it.
  const UNSAFE: [string, ApprovedAnswerId[]][] = [
    ["Can I go back in for my cat?", ["go_back_inside", "go_get_someone"]],
    ["Can I go back inside for my dog?", ["go_back_inside", "go_get_someone"]],
    ["Should I run back in for my pills?", ["go_back_inside", "go_get_someone"]],
    ["Should I go get Susan down the road?", ["go_back_inside", "go_get_someone"]],
    ["Can I return for my wheelchair?", ["go_back_inside", "go_get_someone"]],
    ["Should I turn my oxygen up higher because of the smoke?", ["medical_change"]],
    ["Should I turn up my oxygen?", ["medical_change"]],
    ["Can I use more oxygen?", ["medical_change"]],
    ["How many heart pills should I take?", ["medical_change"]],
    ["Should I take an extra dose of my insulin?", ["medical_change"]],
    ["Should I just stay here and wait for you to come?", []],
    ["Should I stay home?", []],
    ["Should I wait inside?", []],
    ["Should I wait here, or go back for her?", []],
  ];

  it("answer going back or changing a dose only with its safety answer, and staying with nothing", () => {
    for (const [question, allowed] of UNSAFE) {
      for (const id of APPROVED_ANSWER_IDS) assert.equal(mayGetApprovedAnswer(question, id), allowed.includes(id), `${question} -> ${id}`);
      const turn = heard({ policyQuestion: question, reply: "Stay where you are until help reaches you." });
      const answered = withApprovedAnswer(turn, { ...DOG, score: 0.99 });
      assert.equal(answered.approvedAnswer, undefined, question);
      assert.equal(answered.reply, "", `${question}: Claude's own words on a dangerous question are never said`);
    }
  });

  it("say nothing of Claude's own on a dangerous question when Moss has no answer", () => {
    const turn = heard({ policyQuestion: "Should I go get my neighbor?", spokenLanguage: "es", reply: "Anotamos a su vecina, pero no vaya a buscarla todavía." });
    assert.equal(withApprovedAnswer(turn, null).reply, "");
  });

  it("speak the safety answer when Moss matches it", () => {
    const turn = withApprovedAnswer(heard({ policyQuestion: "Can I go back in for my cat?", reply: "I don't know that." }), { id: "go_back_inside", score: 0.88, lookupMs: 2 });
    assert.equal(turn.reply, APPROVED_ANSWERS.go_back_inside.answer.en);
  });

  it("never give a safety answer to an ordinary question, which keeps Claude's \"I don't know that.\"", () => {
    const turn = heard({ policyQuestion: "Can I bring my cat?", reply: "I don't know that." });
    assert.equal(withApprovedAnswer(turn, { id: "go_back_inside", score: 0.99, lookupMs: 2 }), turn);
  });

  it("still answer every phrasing the bank was built from with its own answer", () => {
    for (const id of APPROVED_ANSWER_IDS) {
      for (const question of APPROVED_ANSWERS[id].questions) assert.equal(mayGetApprovedAnswer(question, id), true, `${question} -> ${id}`);
    }
  });
});

describe("fire at home", () => {
  it("gets only the fire-safety steps, never an ordinary answer", () => {
    assert.equal(mayGetApprovedAnswer("It's so hot in here, what do I do?", "heat_inside"), true);
    assert.equal(mayGetApprovedAnswer("It's so hot in here, what do I do?", "medications"), false);
    assert.equal(mayGetApprovedAnswer("What should I pack?", "trapped_by_fire"), false);
  });

  it("gives way to going back and to medicine, and wins over staying", () => {
    assert.equal(mayGetApprovedAnswer("Can I go back in for my cat while it's burning?", "go_back_inside"), true);
    assert.equal(mayGetApprovedAnswer("Should I turn my oxygen up because of the smoke?", "medical_change"), true);
    assert.equal(mayGetApprovedAnswer("Should I stay inside, the fire is at the door?", "trapped_by_fire"), true);
  });
});
