import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import type { AgentRecord, Confidence, Field } from "./record";
import { FIELDS } from "./record";
import { HEARD_ONLY_LANGUAGES, isSpokenLanguage, Language, SPOKEN_LANGUAGES } from "../../convex/languages";
import { Hazard, HAZARDS, hazardEscalation, HazardEscalation } from "../../convex/hazards";
import { currentHazard } from "../hazard";

// Claude's whole job on a call: turn one messy utterance into structured changes plus a short
// acknowledgment. It never decides what to ask next or what may be promised; the state machine does.

export type Emergency = "none" | "medical" | HazardEscalation;
export type Answer = "yes" | "no" | "unclear";

// A language we can't hold a call in (heard-only, or anything else) means the call goes to a person.
export type HeardLanguage = Language | (typeof HEARD_ONLY_LANGUAGES)[number] | "other";
const HEARD_LANGUAGES: readonly string[] = [...SPOKEN_LANGUAGES, ...HEARD_ONLY_LANGUAGES, "other"];

export type Interpretation = {
  updates: AgentRecord;
  confidence: Confidence;
  answer: Answer | null;
  emergency: Emergency;
  asksAboutRide: boolean;
  wantsRepeat: boolean;
  // False for background noise, a pet, a TV, or the resident talking to someone else in the room.
  addressedToAgent: boolean;
  wantsToEnd: boolean;
  neighborAddresses: string[];
  spokenLanguage: HeardLanguage;
  acknowledgment: string;
};

export type TurnContext = {
  language: Language;
  stage: string;
  question: string;
  record: AgentRecord;
  recentTurns: { speaker: "agent" | "resident"; text: string }[];
  utterance: string;
};

const enumOf = (values: readonly string[]) => ({ type: "string", enum: values });

const objectOf = (properties: Record<string, object>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// Changes come back as a short list rather than an object of nullable fields: fewer output tokens
// per turn, which is most of the latency.
const outputSchemaFor = (kind: Hazard) => objectOf({
  changes: {
    type: "array",
    items: objectOf({ field: enumOf(FIELDS), value: { type: "string" }, confidence: { type: "number" } }),
  },
  answer: enumOf(["yes", "no", "unclear", "none"]),
  emergency: enumOf(["none", "medical", hazardEscalation(kind)]),
  asksAboutRide: { type: "boolean" },
  wantsRepeat: { type: "boolean" },
  addressedToAgent: { type: "boolean" },
  wantsToEnd: { type: "boolean" },
  neighborAddresses: { type: "array", items: { type: "string" } },
  spokenLanguage: enumOf(HEARD_LANGUAGES),
  acknowledgment: { type: "string" },
});

// What the resident is facing, and what counts as the hazard being at the home right now.
const HAZARD_CONTEXT: Record<Hazard, { situation: string; atHome: string }> = {
  wildfire: {
    situation: "A wildfire evacuation warning covers their street.",
    atHome: "they can see fire, flames or embers at or next to the home",
  },
  earthquake: {
    situation: "A strong earthquake has just hit their area and their street is in the damage zone. Aftershocks may follow.",
    atHome: "someone is trapped or pinned, part of the home has collapsed, or they smell gas",
  },
  flood: {
    situation: "A flood evacuation warning covers their street.",
    atHome: "water is coming into the home or rising around it",
  },
  hurricane: {
    situation: "A hurricane evacuation order covers their street.",
    atHome: "water is coming into the home, or the roof, walls or windows are failing",
  },
};

const systemFor = (kind: Hazard) => `You interpret one thing a resident just said on an evacuation phone call run by a paratransit agency. ${HAZARD_CONTEXT[kind].situation} You return structured data only.

The household record has these fields and allowed values:
- address: street address where they are now
- canLeave: can everyone in the home leave on their own right now: yes, no, unsure
- hasCar: whether they have a car or a ride out: true, false
- peopleCount: people physically in the home right now, including the speaker: a whole number
- pets: whether there are pets: true, false
- mobility: the most limited mobility of anyone in the home right now, from least to most limited: walks, walker, manual_wheelchair, power_wheelchair, bedbound
- medical: medical needs of people in the home, comma-separated from: oxygen, dialysis, other
- assistanceRequired: help needed getting out of the home: none, one_person_assist, two_person_lift

Rules for changes:
- List a field only when this utterance gives or changes it. List nothing else.
- Corrections matter most. If the resident changes or takes back something already in the record, list the new value. "My husband uses a wheelchair, but he isn't here" means the wheelchair user is not in the home: lower peopleCount and set mobility to what the people present need. "It's just me... no wait, my son is here, he can't get out of bed" raises peopleCount and sets mobility to bedbound.
- A wheelchair is manual_wheelchair unless they say it is electric or powered.
- "Two people to lift", "he needs two of us to carry him", "can't get out of bed without help from two people" mean assistanceRequired two_person_lift.
- Someone who says they can't get out, can't walk far, or has no way to leave has canLeave no. Hesitation or "I don't know how" is unsure.
- assistanceRequired is about physical help getting out of the home. Set it only when they describe needing a person to help them move or lift them. "I can't get out on my own" or "I have no car" alone says nothing about it.
- For address, write the street address as spoken, cleaned up (for example "1182 Mariposa St"). List it only when they give an address different from the one in the record; a plain "yes, I'm here" sets answer to yes and lists no address. If the record has a street with no house number and they give the number, list the full address with both (for example "2585 Catherine Road").
- confidence is 0 to 1. Use below 0.6 when you are guessing.

Other outputs:
- answer: yes, no or unclear when the agent asked a yes-or-no question; none otherwise. When the agent read something back and asked "Is that right?" (or confirmed an address), agreement without the word yes is yes: "thank you", "okay", "mm-hm", "that's it", "correct", "감사합니다", "谢谢", "gracias". Only a correction or a no is no.
- emergency: medical if someone is hurt, can't breathe or has a medical emergency now; ${hazardEscalation(kind)} if ${HAZARD_CONTEXT[kind].atHome}; otherwise none.
- asksAboutRide: true if they ask whether someone is coming, when help arrives, or for any reassurance about a ride. Also true for any demand for a promise, a time or a pickup, even a conditional one: "give me a time and I'll be ready", "if you promise someone's coming, I'll stay put".
- wantsRepeat: true if they didn't hear or understand the question.
- addressedToAgent: false when the text is not the resident talking to the agent: background noise, an animal, a TV or radio, a sound transcribed as a word ("meow", "woof", "beep"), filler alone ("um", "uh"), or the resident talking to someone else in the room ("honey, grab the dog"). When false, list no changes. True otherwise, including a short "yes", a request to repeat, or a request to switch language.
- wantsToEnd: true if they say goodbye, that they're hanging up, or that they need nothing else ("that's all, thanks", "okay bye"). A plain "okay" or "thanks" is false.
- neighborAddresses: addresses or locations of other people who might not be able to leave, if they mention any.
- spokenLanguage: the language the resident is speaking, or asks to speak ("Korean, please" is ko): en English, es Spanish, zh Chinese, ko Korean, vi Vietnamese, tl Tagalog, ru Russian, ja Japanese, hy Armenian, fa Persian, other for any other language. Speech-to-text listens in the call language, so another language can arrive as garbled or nonsensical text in the call language; if the words make no sense as an answer and look like a mistranscription of another language, name that language when you can tell which one it is, and use other only when you can't. A short or unclear answer in the call language is still the call language.
- acknowledgment: at most 6 words in spokenLanguage that show what you understood from this answer, such as "Okay, two people.", "Thanks, a walker." or "Mm, no car." Vary the wording from turn to turn, opening word included: rotate among openers like "Okay", "Thanks", "Mm", "Alright", "Right" or none, never start the same way as the agent's previous turn, and never say "Got it". Empty string when addressedToAgent is false, when the utterance doesn't answer the agent's last question, or when nothing fits. Never say or imply that help, a driver or a vehicle is coming, that they are safe, or any time or number of minutes. Never repeat back a demand for a time, a driver or a pickup. Never ask a question.`;

const forEachHazard = <T>(build: (kind: Hazard) => T) =>
  Object.fromEntries(HAZARDS.map((kind) => [kind, build(kind)])) as Record<Hazard, T>;
const SYSTEM = forEachHazard(systemFor);
const OUTPUT_SCHEMA = forEachHazard(outputSchemaFor);

const client = new Anthropic();

const CHOICES: Partial<Record<Field, readonly string[]>> = {
  canLeave: ["yes", "no", "unsure"],
  mobility: ["walks", "walker", "manual_wheelchair", "power_wheelchair", "bedbound"],
  assistanceRequired: ["none", "one_person_assist", "two_person_lift"],
};
const MEDICAL = new Set(["oxygen", "dialysis", "other"]);
const BOOLEAN_FIELDS = new Set<Field>(["hasCar", "pets"]);

// Turns one listed change into a typed record value, or undefined when the value isn't allowed.
function valueFor(field: Field, raw: string): unknown {
  const value = raw.trim();
  const choices = CHOICES[field];
  if (choices) return choices.includes(value) ? value : undefined;
  if (BOOLEAN_FIELDS.has(field)) return value === "true" ? true : value === "false" ? false : undefined;
  if (field === "peopleCount") {
    const count = Number.parseInt(value, 10);
    return Number.isFinite(count) && count >= 1 ? count : undefined;
  }
  if (field === "medical") return value.split(",").map((item) => item.trim()).filter((item) => MEDICAL.has(item));
  return value === "" ? undefined : value;
}

type RawChange = { field: Field; value: string; confidence: number };

function recordFrom(changes: RawChange[]) {
  const updates: Record<string, unknown> = {};
  const confidence: Confidence = {};
  for (const change of changes) {
    if (!FIELDS.includes(change.field)) continue;
    const value = valueFor(change.field, String(change.value));
    if (value === undefined) continue;
    updates[change.field] = value;
    confidence[change.field] = Math.min(Math.max(Number(change.confidence) || 0.5, 0), 1);
  }
  return { updates: updates as AgentRecord, confidence };
}

const answerFrom = (raw: unknown): Answer | null => (raw === "yes" || raw === "no" || raw === "unclear" ? raw : null);
const emergencyFrom = (raw: unknown, kind: Hazard): Emergency =>
  raw === "medical" || raw === hazardEscalation(kind) ? (raw as Emergency) : "none";
const languageFrom = (raw: unknown, fallback: Language): HeardLanguage =>
  typeof raw === "string" && HEARD_LANGUAGES.includes(raw) ? (raw as HeardLanguage) : fallback;

export const canSpeak = (language: HeardLanguage): language is Language => isSpokenLanguage(language);

function parse(text: string, fallbackLanguage: Language, kind: Hazard): Interpretation {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const { updates, confidence } = recordFrom(Array.isArray(raw.changes) ? (raw.changes as RawChange[]) : []);
  return {
    updates,
    confidence,
    answer: answerFrom(raw.answer),
    emergency: emergencyFrom(raw.emergency, kind),
    asksAboutRide: raw.asksAboutRide === true,
    wantsRepeat: raw.wantsRepeat === true,
    addressedToAgent: raw.addressedToAgent !== false,
    wantsToEnd: raw.wantsToEnd === true,
    neighborAddresses: Array.isArray(raw.neighborAddresses) ? (raw.neighborAddresses as string[]) : [],
    spokenLanguage: languageFrom(raw.spokenLanguage, fallbackLanguage),
    acknowledgment: typeof raw.acknowledgment === "string" ? raw.acknowledgment : "",
  };
}

function promptFor(turn: TurnContext) {
  const history = turn.recentTurns.map((line) => `${line.speaker}: ${line.text}`).join("\n");
  return [
    `Call language: ${turn.language}. Current step: ${turn.stage}.`,
    `Record so far: ${JSON.stringify(turn.record)}`,
    history ? `Recent turns:\n${history}` : "",
    `Agent's last question: ${turn.question}`,
    `Resident just said: ${turn.utterance}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

export async function interpret(turn: TurnContext): Promise<Interpretation> {
  const kind = currentHazard();
  const response = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 1024,
    system: SYSTEM[kind],
    messages: [{ role: "user", content: promptFor(turn) }],
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA[kind] } },
    ...(env.anthropicThinkingOff ? { thinking: { type: "disabled" as const } } : {}),
  });
  const text = response.content.find((block) => block.type === "text");
  if (response.stop_reason === "refusal" || !text || text.type !== "text") {
    throw new Error(`Interpreter returned no text (stop_reason ${response.stop_reason})`);
  }
  return parse(text.text, turn.language, kind);
}
