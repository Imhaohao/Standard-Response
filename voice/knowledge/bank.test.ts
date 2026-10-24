import assert from "node:assert/strict";
import { test } from "node:test";
import { dialogDocs, guidanceText, momentText, principleDocs, PrincipleCard, Script } from "./bank";
import { recall } from "./moss";

const card: PrincipleCard = {
  id: "respect_choice-wildfire-0",
  principle: "respect_choice",
  hazard: "wildfire",
  situation: "The caller won't leave without their dog.",
  callerSays: { en: "I'm not going anywhere without Buster.", es: "No me voy sin mi perro." },
  guidance: "Acknowledge the choice in their words; don't argue.",
  exampleLine: "You won't go without Buster.",
};

test("a principle card is searchable in English and Spanish", () => {
  const docs = principleDocs(card);
  assert.deepEqual(docs.map((doc) => doc.id), ["respect_choice-wildfire-0-en", "respect_choice-wildfire-0-es"]);
  assert.match(docs[1].text, /No me voy sin mi perro/);
  assert.equal(docs[0].metadata?.hazard, "wildfire");
});

test("each resident turn is one document searched the way a live turn asks", () => {
  const script: Script = {
    id: "s0001",
    hazard: "flood",
    language: "es",
    persona: "An older man alone.",
    twists: [],
    seedCall: 3,
    turns: [{ step: "household", agent: "¿Cuántas personas?", resident: "Solo yo", reading: { set: ["peopleCount=1"] }, checked: true },
      { step: "needs", agent: "¿Alguien usa andadera?", resident: "eh", reading: { set: [] }, checked: false },
    ],
  };
  const docs = dialogDocs(script);
  assert.equal(docs.length, 1, "an unchecked turn is not indexed");
  const [doc] = docs;
  assert.equal(doc.id, "s0001-0");
  assert.equal(doc.text, momentText("¿Cuántas personas?", "Solo yo"));
  assert.deepEqual(JSON.parse(doc.metadata!.reading), { set: ["peopleCount=1"] });
  assert.equal(doc.metadata?.language, "es");
});

test("guidance renders principles first, then past moments with their readings", () => {
  const text = guidanceText({
    principles: [{ principle: "respect_choice", situation: card.situation, guidance: card.guidance }],
    moments: [{ text: momentText("Can everyone leave?", "not without my dog"), reading: '{"set":["pets=true"]}' }],
  });
  assert.ok(text.indexOf("respect_choice") < text.indexOf("Resident: not without my dog"));
  assert.match(text, /Reading: \{"set":\["pets=true"\]\}/);
  assert.equal(guidanceText(null), "");
  assert.equal(guidanceText({ principles: [], moments: [] }), "");
});

test("without Moss keys a turn gets no guidance and doesn't wait", async () => {
  const started = Date.now();
  assert.equal(await recall("Can everyone leave?", "no", "wildfire", "en"), null);
  assert.ok(Date.now() - started < 20);
});
