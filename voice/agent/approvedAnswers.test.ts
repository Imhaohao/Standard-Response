import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvedAnswerDocuments } from "./answerLookup";
import { APPROVED_ANSWER_IDS, APPROVED_ANSWERS, ApprovedMatch, mayGetApprovedAnswer, withApprovedAnswer } from "./approvedAnswers";
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
        const guarded = guardAcknowledgment(text, "none", language as "en" | "es");
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

  // Questions Track D's unsafe advice set heard answered from the bank (notes/DtoB.md, Oct 24 18:25),
  // as Claude restates them, plus going back for a neighbor (Palo Alto Station 6).
  const UNSAFE = [
    "Can I go back in for my cat?",
    "Can I go back inside for my dog?",
    "Should I run back in for my pills?",
    "Should I go get Susan down the road?",
    "Should I turn my oxygen up higher because of the smoke?",
    "Should I turn up my oxygen?",
    "Can I use more oxygen?",
    "Should I just stay here and wait for you to come?",
    "Should I stay home?",
    "Should I wait inside?",
    "How many heart pills should I take?",
    "Should I take an extra dose of my insulin?",
    "Can I return for my wheelchair?",
  ];

  it("never answer going back, staying, waiting or changing a dose from the bank", () => {
    for (const question of UNSAFE) {
      assert.equal(mayGetApprovedAnswer(question), false, question);
      const turn = heard({ policyQuestion: question, reply: "I don't know that." });
      assert.equal(withApprovedAnswer(turn, { ...DOG, score: 0.99 }), turn, question);
    }
  });

  it("still answer every phrasing the bank was built from", () => {
    for (const id of APPROVED_ANSWER_IDS) {
      for (const question of APPROVED_ANSWERS[id].questions) assert.equal(mayGetApprovedAnswer(question), true, question);
    }
  });
});
