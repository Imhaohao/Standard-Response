import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import type { AgentRecord, Confidence, Field } from "./record";
import { FIELDS } from "./record";
import { HEARD_ONLY_LANGUAGES, isSpokenLanguage, Language, SPOKEN_LANGUAGES } from "../../convex/languages";
import { Hazard, HAZARDS, hazardEscalation, HazardEscalation } from "../../convex/hazards";
import { currentHazard } from "../hazard";
import { Guidance, guidanceText } from "../knowledge/bank";
import { recall } from "../knowledge/moss";
import type { ApprovedMatch } from "./approvedAnswers";
import { Ask, ASK_RULES, ASK_SCHEMA, askFrom, GoalPrompt, goalsText } from "./askLine";

// Claude's whole job on a call: turn one messy utterance into structured changes plus a short
// acknowledgment, and word the next question. It never decides what to ask next or what may be
// promised; the state machine does, and speaks Claude's question only for the goal it chose (askLine.ts).

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
  // "Hold on, let me ask my daughter": the agent waits instead of asking again.
  wantsTime: boolean;
  // "What should I bring?", "Do I wait outside?": the code's fixed steps answer it.
  asksWhatToDo: boolean;
  // "¿Puede venir mi perro?" restated as "Can my dog come?", for the approved-answer lookup
  // (approvedAnswers.ts). Empty when they asked no such question.
  policyQuestion: string;
  // They said which kind of wheelchair: one that's pushed, or one with a motor.
  saysChairKind?: boolean;
  neighborAddresses: string[];
  spokenLanguage: HeardLanguage;
  acknowledgment: string;
  // A few words naming what a frightened or upset resident feels, said before the facts.
  feeling: string;
  // A short answer to something the resident asked or said that isn't an answer to the question.
  reply: string;
  // Set when reply holds an approved answer Moss matched, rather than Claude's words.
  approvedAnswer?: ApprovedMatch;
  // The next question in Claude's words, for the goal Claude expects the code to ask about.
  ask?: Ask;
  // "I don't know", "I'm not sure": the question has no better answer to wait for.
  unsure?: boolean;
};

export type TurnContext = {
  language: Language;
  stage: string;
  // Where the call is in the outline (conversation.ts OUTLINE) and what that stage is for.
  outline: { stage: string; goal: string };
  question: string;
  // The goals the code may ask about after this answer, current first.
  goals?: GoalPrompt[];
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

// Output tokens cost about 3 ms each on Haiku, a third of a turn, so the wire format is terse: each
// change as one "field=value" string, short keys, and the rare conditions as a list of the ones that
// hold. The answer and the emergency stay single choices: as flags, "flames blowing in" came back
// as both medical and flames, and the wrong escalation won.
// Names say what the resident does: a bare "repeat" was read as "the resident is repeating
// themselves" and held a question for eleven turns, and "ends" hung up on "I won't leave without my son".
const CONDITIONS = ["asks_ride", "asks_repeat", "not_to_agent", "goodbye", "wants_time", "asks_what_to_do", "says_chair_kind", "says_unsure"] as const;
type Condition = (typeof CONDITIONS)[number];
const GUESSED_CONFIDENCE = 0.5;
const HEARD_CONFIDENCE = 0.9;

// Only set is required. Every other key is written when it has something to say, so a plain answer
// comes back as {"set":["peopleCount=2"]}, 16 tokens instead of 55 with every empty key spelled out.
const outputSchemaFor = (kind: Hazard) => ({
  ...objectOf({
    set: { type: "array", items: { type: "string" } },
    guessed: { type: "array", items: enumOf(FIELDS) },
    answer: enumOf(["yes", "no", "unclear"]),
    emergency: enumOf(["medical", hazardEscalation(kind)]),
    flags: { type: "array", items: enumOf(CONDITIONS) },
    neighbors: { type: "array", items: { type: "string" } },
    language: enumOf(HEARD_LANGUAGES),
    feeling: { type: "string" },
    ack: { type: "string" },
    reply: { type: "string" },
    policy_question: { type: "string" },
    ask: ASK_SCHEMA,
  }),
  required: ["set"],
});

// What the resident is facing, and what counts as the hazard being at the home right now.
const HAZARD_CONTEXT: Record<Hazard, { situation: string; atHome: string }> = {
  wildfire: {
    situation: "A wildfire evacuation warning covers their street.",
    atHome: "they can see fire, flames or embers at or next to the home, someone there is fighting the fire, or they are trapped or say they won't make it",
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

// The agent's constitution, from 911 call-taker, crisis-line and evacuation-warning practice. The
// interpreter prompt states it, and the voice exam's judge (voice/exam/judge.ts) grades calls by it.
export const CALL_TAKER_PRINCIPLES = [
  { id: "truth_over_comfort", text: `Truth over comfort. Say only what this prompt, the record and the agent's earlier words support. If you don't know, say so plainly ("I don't know that yet.") rather than guess about the fire, roads, shelters or timing.` },
  { id: "promise_effort", text: "Promise effort, never outcomes. Never say or imply that someone is safe, that help is coming, or when." },
  { id: "calm_and_short", text: `Calm and short. One idea per sentence, plain everyday words, no agency jargon, codes or "voluntary".` },
  { id: "show_you_heard", text: `Show you heard. Reflect the resident's own words briefly instead of a generic "okay".` },
  { id: "name_the_feeling", text: `Name a feeling in a few words, then move on: "That sounds frightening." Never a long apology or scripted sympathy.` },
  { id: "say_why", text: "Say why you ask. If they ask why a question matters, tie it to their need: the right vehicle, the right help at the door." },
  { id: "honest_about_automation", text: "Be honest about being automated. If asked whether this is a robot or a real person, say it is 911's automated assistant, working with the dispatchers." },
  { id: "life_threats_first", text: "Life threats come first. Flag an emergency even mid-sentence; the code marks it urgent for a dispatcher. Never tell them to call 911: this call is 911." },
  { id: "respect_choice", text: "Respect their choice. If they say they won't leave, don't argue or guilt them; acknowledge it and let the code continue." },
  { id: "adult_to_adult", text: "Talk to the person on the line as an adult; never talk down, and take their word about a disability." },
  { id: "serve_the_stage", text: "Serve the stage goal you are given. Answer what they asked first; the code then picks the conversation back up." },
] as const;
export type PrincipleId = (typeof CALL_TAKER_PRINCIPLES)[number]["id"];

const numberedPrinciples = CALL_TAKER_PRINCIPLES.map((principle, index) => `${index + 1}. ${principle.text}`).join("\n");

const systemFor = (kind: Hazard) => `You interpret one thing a resident just said on an evacuation phone call run by a paratransit agency. ${HAZARD_CONTEXT[kind].situation} You return structured data only: set always, and every other key only when it has something to say (leave it out rather than write none, an empty list or an empty string; language only when it isn't the call language).

How the agent talks. The code picks the next goal and owns every line about a ride, status, safety, the read-back and the goodbye; you write the acknowledgment, the reply and the next question's wording (ask), and they follow these principles, which come from 911 call-taker, crisis-line and evacuation-warning practice:
${numberedPrinciples}

The household record has these fields and allowed values:
- address: street address where they are now
- canLeave: can everyone in the home leave on their own right now: yes, no, unsure
- hasCar: whether they have a car or a ride out: true, false
- peopleCount: people physically in the home right now, including the speaker: a whole number
- pets: whether there are pets: true, false
- mobility: the most limited mobility of anyone in the home right now, from least to most limited: walks, walker, manual_wheelchair, power_wheelchair, bedbound
- medical: medical needs of people in the home, comma-separated from: oxygen, dialysis, other. Speech-to-text often mishears oxygen as "autism", "auction", "oxen" or "ox and"; when the agent asked about oxygen in the recent turns and the resident "needs" one of these, it is oxygen (guessed), never other.
- assistanceRequired: help needed getting out of the home: none, one_person_assist, two_person_lift

Rules for changes:
- set lists each field this utterance gives or changes as field=value, such as peopleCount=2, mobility=walker or address=1182 Mariposa St. List a field only when this utterance gives or changes it. List nothing else.
- Corrections matter most. If the resident changes or takes back something already in the record, list the new value. "My husband uses a wheelchair, but he isn't here" means the wheelchair user is not in the home: lower peopleCount and set mobility to what the people present need. "It's just me... no wait, my son is here, he can't get out of bed" raises peopleCount and sets mobility to bedbound.
- peopleCount only when they give the number or list who is home now. Someone mentioned in passing ("my son can't get out of bed") doesn't give it.
- A wheelchair is manual_wheelchair unless they say it is electric or powered. When they say which kind it is, also list the says_chair_kind flag.
- "Two people to lift", "he needs two of us to carry him", "can't get out of bed without help from two people" mean assistanceRequired two_person_lift.
- "They need a person to wheel them out", "someone has to push her chair", "my son helps me to the car", "I need help getting to the door" mean assistanceRequired one_person_assist: one helper. It is two_person_lift only when they say it takes two people or that they must be lifted or carried; a wheelchair, oxygen or several people in the home doesn't make it two.
- Someone who says they won't leave (without a pet, a person or their home) has canLeave unsure when the record has no canLeave yet; it never replaces a recorded no. Respect it and don't argue.
- "Nobody", "no one", "I don't have anyone" or "you'd have to come get me" to the car question means hasCar=false.
- Someone who says they can't get out, can't walk far, or has no way to leave has canLeave no. Hesitation or "I don't know how" is unsure, and so is "I don't know" to the can-leave question, even with more said after it. Someone who says they are leaving or evacuating now ("we're getting in the car", "we're panicking to evacuate") has canLeave yes.
- mobility is the most limited of anyone in the home now. Mentioning someone less limited never lowers it: after "my son can't get out of bed", "I'm in the wheelchair" keeps bedbound.
- An emergency in the same answer doesn't replace the answer: set the fields it gives as well.
- assistanceRequired is about physical help getting out of the home. Set it only when they describe needing a person to help them move or lift them. "I can't get out on my own" or "I have no car" alone says nothing about it.
- For address, write the street address as spoken, cleaned up (for example "1182 Mariposa St"). List it only when they give an address different from the one in the record; a plain "yes, I'm here" sets answer to yes and lists no address. Digits said one at a time make one number: "four five East Mariposa" is 45 East Mariposa, "two six zero nine" is 2609. If the record has a street with no house number and they give the number, list the full address with both (for example "2585 Catherine Road").
- Speech-to-text on a phone line often turns a word into one that sounds like it. Read every answer against the agent's last question and the recent turns, not word by word: when a word makes no sense there but sounds like something the agent just asked about or an allowed value, read it as that word and list the field in guessed so the read-back checks it. After a question about oxygen, "one person who desperately needs autism" or "she's on auction" means oxygen (nobody needs autism), but "my son has autism" makes sense and is medical other. A head count answered "we're all ate" is 8. When no sound-alike fits, leave the field out so the agent asks again. Never say the misheard word back in ack or reply.
- guessed: the fields in set that you are guessing at. Usually empty.

Other outputs:
- answer: yes, no or unclear when the agent asked a yes-or-no question; none otherwise. When the agent read something back and asked "Is that right?" (or confirmed an address), agreement without the word yes is yes: "thank you", "okay", "mm-hm", "that's it", "correct", "감사합니다", "谢谢", "gracias". Only a correction or a no is no.
- emergency: medical if someone is hurt, can't breathe or has a medical emergency now; ${hazardEscalation(kind)} if ${HAZARD_CONTEXT[kind].atHome}; otherwise none. Fear, panic or hurrying to leave is not an emergency on its own: "We're panicking to evacuate" is none.
- flags: each of these that holds for this utterance, else an empty list.
  - asks_ride: they ask whether someone is coming, when help arrives, or for any reassurance about a ride. Also any plea for help ("please, help us", "please hurry", "get them here now", "send someone"), asking whether anyone knows they are there, or whether to wait. Not asking whether the agent will stay on the line: reply answers that ("Yes, I'm staying on the line with you."). Also for any demand for a promise, a time or a pickup, even a conditional one: "give me a time and I'll be ready", "if you promise someone's coming, I'll stay put".
  - asks_repeat: they ask the agent to say it again because they didn't hear or understand the question, or check the line is there ("Hello? Hello?"). Not when they repeat themselves.
  - not_to_agent: the text is not the resident talking to the agent: background noise, an animal, a TV or radio, a sound transcribed as a word ("meow", "woof", "beep"), filler alone ("um", "uh"), or the resident talking to someone else in the room ("honey, grab the dog"). When listed, list no changes. Never for a short "yes", a request to repeat, or a request to switch language.
  - goodbye: they say goodbye, that they're hanging up, or that they need nothing else ("that's all, thanks", "okay bye"). A plain "okay", "thanks" or "okay, thank you" is not goodbye, and neither is refusing to leave ("I'm not leaving without my son").
  - wants_time: they ask the agent to wait a moment, or say they're going to check or ask someone first ("hold on", "one second", "let me ask my daughter", "let me think").
  - says_chair_kind: they say which kind of wheelchair it is: manual, one they or someone else pushes, or electric, powered, motorized or battery.
  - says_unsure: they say they don't know or aren't sure, and give no answer to the question.
  - asks_what_to_do: they ask what they should do, bring or get ready while they wait, or where to wait ("what should I do now?", "should I pack anything?", "do I wait outside?"). The code answers with its own fixed steps.
- neighbors: addresses or locations of other people who might not be able to leave, if they mention any. Only people who may need help, never where the fire is ("flames in my neighbor's yard" is not one). A caller who is away from the home and calling about someone there ("I'm in the car, he's at our house, 3037 Ewing Street") gives the household's address: set address, not neighbors. Write a street address with its house number when they give one ("45 East Mariposa"); otherwise write the place as said ("the house across the street"). When they give the address of someone they mentioned earlier ("it's 955 La Canada Verdugo Road"), list that address here, never in set.
- language: the language the resident is speaking, or asks to speak ("Korean, please" is ko): en English, es Spanish, zh Chinese, ko Korean, vi Vietnamese, tl Tagalog, ru Russian, ja Japanese, hy Armenian, fa Persian, other for any other language. Speech-to-text listens in the call language, so another language can arrive as garbled or nonsensical text in the call language; if the words make no sense as an answer and look like a mistranscription of another language, name that language when you can tell which one it is, and use other only when you can't. A short or unclear answer in the call language is still the call language.
- feeling: when the resident sounds frightened, panicked, desperate or upset (pleading, asking anxiously whether anyone knows they are there, saying not to risk anyone for them), at most 5 words in their language naming it, such as "That sounds frightening." or "I can hear how scared you are."; otherwise empty, and empty when the agent named a feeling in its previous turn. Never an apology, and never comfort that could be false ("it's okay", "don't worry").
- ack: at most 6 words in the resident's language that show what you understood from this answer, such as "Two people.", "Thanks, a walker." or "Mm, no car." Empty string when set lists canLeave, hasCar, peopleCount, mobility, medical, assistanceRequired or pets, because the code then speaks its own fixed echo of those; for anything else it reflects the answer ("Alright, that's the address."). On hold, or when they plead or ask about the ride, reflect their words in a few words without any promise ("You need help fast.", "You want to know they know you're here."). This matters most for a yes, a no or a confirmation: reflect what they agreed to ("You can leave on your own.", "Alright, that's the address.") rather than a bare "Okay". Vary the wording from turn to turn, opening word included: rotate among openers like "Thanks", "Mm", "Alright", "Right" or none, use "Okay" at most once in a call, never start the same way as the agent's previous turn, and never say "Got it". Empty string when not_to_agent is listed, when the utterance doesn't answer the agent's last question, or when nothing fits. Never say or imply that help, a driver or a vehicle is coming, that they are safe, or any time or number of minutes. Never repeat back a demand for a time, a driver or a pickup. Never tell them to take their time or to wait. Plain words only: never "readback", "record", "flag" or "confirmed". Never ask a question.
- reply: when the resident asks the agent something or says something that isn't an answer to the agent's last question (why the agent needs to know, who is calling, what is going on, that they're scared or confused, that they won't leave without someone, whether the agent will stay on the line), one short, calm sentence of at most 20 words in the resident's language that responds to it directly, such as "It helps us match the right vehicle to your needs." or "This is 911, calling about the evacuation in Altadena." State only what this prompt and the agent's own earlier words say; never invent details about the hazard, roads, shelters, routes or orders. Never mention help, crews, vehicles, sending, plans or what dispatchers are doing: the code's status line is the only thing said about those. If you don't know, say so ("I don't know that."). Never give safety advice or directions of your own; the code's lines give the only advice. Never say you are marking, noting or recording anything. "Are we supposed to evacuate?" gets "If you can leave safely, leave now." (say a warning covers their street only if the agent's greeting said so). Never repeat sympathy the feeling already named. Name people only as the resident did ("he", "my son"); never guess who someone is. Don't ask a question, because the agent asks its next question itself. Empty string when they answered the question, asked about a ride (a fixed status message answers that), asked to repeat, asked the agent to wait, asked what to do or bring (asks_what_to_do), or when not_to_agent is listed. The ack's limits apply here too: never say or imply that help, a driver or a vehicle is coming, that they are safe, or any time or number, and never repeat back a demand.
- policy_question: when they ask whether they may bring or take something or someone along (pets, oxygen, medications, dialysis supplies, a wheelchair, walker, cane or scooter, papers, a caregiver or family member), what the shelter has, or whether the ride costs anything, that question as a short plain question in English in their own terms ("Can I bring my cat?", "Can my granddaughter come?", "Is there food at the shelter?"). Also when they ask whether to go back inside or back for someone or something, or to change a medicine dose or an oxygen setting ("Can I go back in for my cat?", "Should I go get my neighbor?", "Should I turn my oxygen up?"): the code has the agency's safety answer for those. Always English, never the language they spoke: "¿Puedo llevar a mi gato?" is "Can I bring my cat?" and "¿Cuánto cuesta?" is "How much does the ride cost?". Otherwise leave it out. When it is set and asks_what_to_do isn't listed, reply is "I don't know that." in their language; the code replaces it with the agency's approved answer when it has one.
${ASK_RULES}
  - Never write ask for the read-back, a status, the hold or the goodbye; on this call never mention a ride at all.`;

const forEachHazard = <T>(build: (kind: Hazard) => T) =>
  Object.fromEntries(HAZARDS.map((kind) => [kind, build(kind)])) as Record<Hazard, T>;
export const SYSTEM = forEachHazard(systemFor);
export const OUTPUT_SCHEMA = forEachHazard(outputSchemaFor);

// Made on the first turn, so the state machine can be loaded (and tested) without a key.
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const CHOICES: Partial<Record<Field, readonly string[]>> = {
  canLeave: ["yes", "no", "unsure"],
  mobility: ["walks", "walker", "manual_wheelchair", "power_wheelchair", "bedbound"],
  assistanceRequired: ["none", "one_person_assist", "two_person_lift"],
};
const MEDICAL = new Set(["oxygen", "dialysis", "other"]);
const BOOLEAN_FIELDS = new Set<Field>(["hasCar", "pets"]);

const BOOLEAN_VALUES: Record<string, boolean> = { true: true, false: false };
// What Claude writes for an address it didn't hear. Spoken back, it became "the house number on none".
const PLACEHOLDERS = new Set(["none", "unknown", "n/a", "null", "not given"]);

const countFrom = (value: string) => {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count >= 1 ? count : undefined;
};

const medicalFrom = (value: string) => value.split(",").map((item) => item.trim()).filter((item) => MEDICAL.has(item));

// Turns one listed change into a typed record value, or undefined when the value isn't allowed.
function valueFor(field: Field, raw: string): unknown {
  const value = raw.trim();
  const choices = CHOICES[field];
  if (choices) return choices.includes(value) ? value : undefined;
  if (BOOLEAN_FIELDS.has(field)) return BOOLEAN_VALUES[value];
  if (field === "peopleCount") return countFrom(value);
  if (field === "medical") return medicalFrom(value);
  return value === "" || PLACEHOLDERS.has(value.toLowerCase()) ? undefined : value;
}

// "peopleCount=2" to a field and its typed value, or undefined when either isn't allowed.
function changeFrom(raw: unknown): [Field, unknown] | undefined {
  if (typeof raw !== "string") return undefined;
  const split = raw.indexOf("=");
  const field = raw.slice(0, split).trim() as Field;
  if (split < 0 || !FIELDS.includes(field)) return undefined;
  const value = valueFor(field, raw.slice(split + 1));
  return value === undefined ? undefined : [field, value];
}

function recordFrom(set: unknown[], guessed: unknown[]) {
  const updates: Record<string, unknown> = {};
  const confidence: Confidence = {};
  for (const [field, value] of set.map(changeFrom).filter((change) => change !== undefined)) {
    updates[field] = value;
    confidence[field] = guessed.includes(field) ? GUESSED_CONFIDENCE : HEARD_CONFIDENCE;
  }
  return { updates: updates as AgentRecord, confidence };
}

const answerFrom = (raw: unknown): Answer | null => (raw === "yes" || raw === "no" || raw === "unclear" ? raw : null);
const emergencyFrom = (raw: unknown, kind: Hazard): Emergency =>
  raw === "medical" || raw === hazardEscalation(kind) ? (raw as Emergency) : "none";
const languageFrom = (raw: unknown, fallback: Language): HeardLanguage =>
  typeof raw === "string" && HEARD_LANGUAGES.includes(raw) ? (raw as HeardLanguage) : fallback;

export const canSpeak = (language: HeardLanguage): language is Language => isSpokenLanguage(language);

const listOf = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
const textOf = (raw: unknown) => (typeof raw === "string" ? raw : "");

export function parse(text: string, fallbackLanguage: Language, kind: Hazard): Interpretation {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const { updates, confidence } = recordFrom(listOf(raw.set), listOf(raw.guessed));
  const flags = new Set(listOf(raw.flags) as Condition[]);
  return {
    updates,
    confidence,
    answer: answerFrom(raw.answer),
    emergency: emergencyFrom(raw.emergency, kind),
    asksAboutRide: flags.has("asks_ride"),
    wantsRepeat: flags.has("asks_repeat"),
    addressedToAgent: !flags.has("not_to_agent"),
    wantsToEnd: flags.has("goodbye"),
    wantsTime: flags.has("wants_time"),
    asksWhatToDo: flags.has("asks_what_to_do"),
    policyQuestion: textOf(raw.policy_question),
    saysChairKind: flags.has("says_chair_kind"),
    neighborAddresses: listOf(raw.neighbors) as string[],
    spokenLanguage: languageFrom(raw.language, fallbackLanguage),
    acknowledgment: textOf(raw.ack),
    feeling: textOf(raw.feeling),
    reply: textOf(raw.reply),
    ask: askFrom(raw.ask),
    unsure: flags.has("says_unsure"),
  };
}

function promptFor(turn: TurnContext, guidance: Guidance | null) {
  const history = turn.recentTurns.map((line) => `${line.speaker}: ${line.text}`).join("\n");
  return [
    `Call language: ${turn.language}. Current step: ${turn.stage}.`,
    `Call stage: ${turn.outline.stage}. Goal of this stage: ${turn.outline.goal}`,
    guidanceText(guidance),
    `Record so far: ${JSON.stringify(turn.record)}`,
    history ? `Recent turns:\n${history}` : "",
    goalsText(turn.goals),
    `Agent's last question: ${turn.question}`,
    `Resident just said: ${turn.utterance}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

// Identical requests vary from 0.6 to 1.5 s before the first token, so each turn sends three and
// takes whichever answers first (a hedged request). The others are left to finish, not cancelled:
// cancelling closes their connections, and the next turns paid a new handshake. Measured on Haiku,
// first of three uncancelled: p50 0.59 s, p90 0.81 s; first of two cancelled: p50 0.70 s, p90 1.05 s.
const HEDGED_REQUESTS = Number(process.env.VOICE_HEDGED_REQUESTS ?? 3);

// Opus runs in fast mode (a research preview, up to 2.5x the output speed): measured on the real
// prompt it answered in 1.1 s with a tight tail while Haiku took 1.5 s. Opus 5.5 can't turn thinking
// off, so low effort keeps it short. Fast mode has its own rate limit; when it is hit the turn runs
// at standard speed rather than failing.
const FAST_MODELS = new Set(["claude-opus-5-5", "claude-opus-5"]);

function request(turn: TurnContext, kind: Hazard, guidance: Guidance | null) {
  const params = {
    model: env.anthropicModel,
    max_tokens: 1024,
    // The prompt is the same on every turn, so caching it cuts each turn's time to first token.
    system: [{ type: "text" as const, text: SYSTEM[kind], cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: promptFor(turn, guidance) }],
    output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema: OUTPUT_SCHEMA[kind] } },
  };
  const standard = () =>
    anthropic().messages.create(
      { ...params, ...(env.anthropicThinkingOff && !FAST_MODELS.has(params.model) ? { thinking: { type: "disabled" as const } } : {}) },
    );
  if (!FAST_MODELS.has(params.model)) return standard();
  return anthropic()
    .beta.messages.create({ ...params, betas: ["fast-mode-2026-02-01"], speed: "fast" })
    .catch((error: unknown) => (error instanceof Anthropic.RateLimitError ? standard() : Promise.reject(error)));
}

export const interpret = (turn: TurnContext) => interpretFor(turn, currentHazard());

// For a hazard other than the operator's current one: the dialog bank's checker reads every hazard.
export async function interpretFor(turn: TurnContext, kind: Hazard): Promise<Interpretation> {
  const guidance = await recall(turn.question, turn.utterance, kind, turn.language);
  const response = await Promise.any(Array.from({ length: HEDGED_REQUESTS }, () => request(turn, kind, guidance)));
  const text = response.content.find((block) => block.type === "text");
  if (response.stop_reason === "refusal" || !text || text.type !== "text") {
    throw new Error(`Interpreter returned no text (stop_reason ${response.stop_reason})`);
  }
  return parse(text.text, turn.language, kind);
}
