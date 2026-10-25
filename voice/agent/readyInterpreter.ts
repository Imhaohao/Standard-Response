import Anthropic from "@anthropic-ai/sdk";
import { newAnthropic } from "../anthropicClient";
import type { Doc } from "../../convex/_generated/dataModel";
import { env } from "../env";
import { Ask, ASK_RULES, ASK_SCHEMA, askFrom, GoalPrompt, goalsText } from "./askLine";
import { withFallback } from "./fallbackModel";
import { jsonReply, jsonRule } from "./jsonReply";
import { WARM_UP_TEXT, warmer } from "./warmUp";
import type { Answer } from "./interpreter";
import type { Language } from "./script";

// Claude's job on a Ready check call: turn one answer into profile fields plus a short
// acknowledgment, and word the next question. Nothing here is about a ride; there is no warning
// yet. readyCall.ts decides what to ask next and speaks Claude's wording only for that goal.

type Household = Doc<"households">;
type ReadyProfile = NonNullable<Household["ready"]>;
export type Mobility = NonNullable<Household["mobility"]>;
export type Assistance = NonNullable<Household["assistanceRequired"]>;
export type MedicalNeed = NonNullable<Household["medical"]>[number];
export type CareNeed = ReadyProfile["care"][number];
export type ExitPlan = ReadyProfile["exitPlan"];
export type BedroomFloor = NonNullable<ReadyProfile["bedroom"]>["floor"];
export type BedroomSide = NonNullable<NonNullable<ReadyProfile["bedroom"]>["side"]>;

export type ReadyUpdates = {
  residentName?: string;
  address?: string;
  peopleCount?: number;
  mobility?: Mobility;
  medical?: MedicalNeed[];
  assistanceRequired?: Assistance;
  pets?: boolean;
  hasCar?: boolean;
  bedroomFloor?: BedroomFloor;
  bedroomSide?: BedroomSide;
  care?: CareNeed[];
  exitPlan?: ExitPlan;
  helperName?: string;
  helperPhone?: string;
  helperRelation?: string;
  note?: string;
};
type ReadyField = keyof ReadyUpdates;

export type ReadyHeard = {
  answer: Answer | null;
  updates: ReadyUpdates;
  emergency: boolean;
  asksAboutRide: boolean;
  wantsRepeat: boolean;
  wantsToEnd: boolean;
  addressedToAgent: boolean;
  acknowledgment: string;
  // The next question in Claude's words, for the goal Claude expects the code to ask about.
  ask?: Ask;
  // "I don't know", "not sure": the question has no better answer to wait for.
  unsure?: boolean;
};

export type ReadyTurnContext = {
  language: Language;
  step: string;
  question: string;
  // The goals the code may ask about after this answer, current first.
  goals?: GoalPrompt[];
  answers: Record<string, unknown>;
  recentTurns: { speaker: "agent" | "resident"; text: string }[];
  utterance: string;
};

export type ReadyInterpret = (turn: ReadyTurnContext) => Promise<ReadyHeard>;

const MOBILITY: readonly Mobility[] = ["walks", "walker", "manual_wheelchair", "power_wheelchair", "bedbound"];
const ASSISTANCE: readonly Assistance[] = ["none", "one_person_assist", "two_person_lift"];
const MEDICAL: readonly MedicalNeed[] = ["oxygen", "dialysis", "other"];
const CARE: readonly CareNeed[] = ["hearing", "sight", "memory", "power_device", "service_animal"];
const EXIT_PLANS: readonly ExitPlan[] = ["own_car", "helper", "needs_ride"];
const FLOORS: readonly BedroomFloor[] = ["ground", "upstairs", "basement"];
const SIDES: readonly BedroomSide[] = ["front", "back"];

const text = (raw: string) => (raw.trim() === "" ? undefined : raw.trim());
const count = (raw: string) => {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : undefined;
};
const flag = (raw: string) => (raw === "true" ? true : raw === "false" ? false : undefined);
const oneOf = <T extends string>(values: readonly T[]) => (raw: string) => (values.includes(raw as T) ? (raw as T) : undefined);
const listOf = <T extends string>(values: readonly T[]) => (raw: string) =>
  raw.split(",").map((item) => item.trim()).filter((item): item is T => values.includes(item as T));

// A US number in E.164, the form the dialer and its allowlist use. Anything shorter isn't a phone.
export function phoneFrom(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.trim().startsWith("+") && digits.length > 10 ? `+${digits}` : undefined;
}

const PARSERS: Record<ReadyField, (raw: string) => unknown> = {
  residentName: text,
  address: text,
  peopleCount: count,
  mobility: oneOf(MOBILITY),
  medical: listOf(MEDICAL),
  assistanceRequired: oneOf(ASSISTANCE),
  pets: flag,
  hasCar: flag,
  bedroomFloor: oneOf(FLOORS),
  bedroomSide: oneOf(SIDES),
  care: listOf(CARE),
  exitPlan: oneOf(EXIT_PLANS),
  helperName: text,
  helperPhone: phoneFrom,
  helperRelation: text,
  note: text,
};
const FIELDS = Object.keys(PARSERS) as ReadyField[];

const SYSTEM = `You interpret one thing a resident just said on a calm phone call from 911 in Altadena. There is no emergency and no warning: we are calling every household ahead of time to note who might need help if there is ever an evacuation. You return structured data only.

Profile fields and allowed values:
- residentName: the speaker's name, if they give it
- address: a street address, only when they correct the one we have on file (for example "1182 Mariposa St")
- peopleCount: how many people live in the home, a whole number
- mobility: the most limited mobility of anyone who lives there: walks, walker, manual_wheelchair, power_wheelchair, bedbound. A wheelchair is manual_wheelchair unless they say electric or powered.
- medical: comma-separated from oxygen, dialysis, other
- assistanceRequired: help getting out of the home: none, one_person_assist, two_person_lift. One person to push a chair or help them to the car is one_person_assist; two_person_lift only when they say it takes two people or that they must be lifted or carried.
- pets: true or false
- hasCar: true or false
- bedroomFloor: where the person who'd need help sleeps: ground, upstairs, basement. A one-story house is ground.
- bedroomSide: front or back of the house
- care: comma-separated from hearing (hard of hearing or deaf), sight (low vision or blind), memory (memory loss or dementia), power_device (depends on a powered medical device like a CPAP, ventilator or powered bed), service_animal
- exitPlan: how they would get out if an evacuation were ordered: own_car (they or someone in the home drives), helper (a friend, relative or neighbor would pick them up), needs_ride (they'd need a ride from us)
- helperName: the name of the person who'd pick them up
- helperPhone: that person's phone number, digits as spoken (for example "626 555 0123"). Spell out spoken digits as numerals.
- helperRelation: how they know the helper, such as daughter or neighbor
- note: something a crew should know, like a gate code or where a key is, in the resident's words cleaned up

Rules:
- List a field only when this utterance gives or changes it. A correction to an earlier answer lists the new value.
- An answer to the question that fits no allowed value exactly still counts: list the closest value rather than nothing, so the question isn't asked again. A number of helpers is assistanceRequired by count: 0 none, 1 one_person_assist, 2 or more ("5", "three people") two_person_lift.
- When the question asks about mobility needs and they say nobody has any, list mobility walks and an empty medical (value "").
- When the question asks about care needs and they say none, list care with value "".
- At the exit plan or helper question, "nobody", "no one", "I don't have anyone", "I'd need you to come get me" or "I don't know how I'd get out" mean exitPlan needs_ride, with no helper fields. Never leave the plan unset for those.
- unsure: true when they say they don't know or aren't sure and give no answer to the question; the code then moves on instead of asking again.
- answer: yes, no or unclear when the agent asked a yes-or-no question (including "is now okay?", "is that right?" and "is there anything...?"); null otherwise. "No", "nothing", "nope, nothing" and "not really" to "is there anything...?" are no.
- emergency: true only if someone is hurt, can't breathe or is in danger right now.
- asksAboutRide: true if they ask whether we will come get them or send someone.
- wantsRepeat: true if they didn't hear or understand the question.
- wantsToEnd: true if they say they have to go, don't want to continue, or say goodbye.
- addressedToAgent: false for background noise, an animal, a TV, filler alone ("um"), or talk to someone else in the room. When false, list nothing.
- acknowledgment: at most 6 words in the call language that show what you understood, such as "Three of you, thanks." or "Mm, a walker." Vary the opening word from turn to turn and never start the way the agent's last turn did; say "Okay" at most once in a call, and never "Got it". Empty when addressedToAgent is false or nothing fits. Never promise a ride, help, a visit or a time. Never ask a question.
${ASK_RULES}
  - On this call "you'd need a ride from us, then" is fine to say back about the plan; it is a fact about them, not a promise. Say "firefighters", never "crew". Use null when you leave ask out.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: { field: { type: "string", enum: FIELDS }, value: { type: "string" } },
        required: ["field", "value"],
        additionalProperties: false,
      },
    },
    answer: { anyOf: [{ type: "string", enum: ["yes", "no", "unclear"] }, { type: "null" }] },
    emergency: { type: "boolean" },
    asksAboutRide: { type: "boolean" },
    wantsRepeat: { type: "boolean" },
    wantsToEnd: { type: "boolean" },
    addressedToAgent: { type: "boolean" },
    acknowledgment: { type: "string" },
    unsure: { type: "boolean" },
    ask: { anyOf: [ASK_SCHEMA, { type: "null" }] },
  },
  required: ["changes", "answer", "emergency", "asksAboutRide", "wantsRepeat", "wantsToEnd", "addressedToAgent", "acknowledgment", "unsure", "ask"],
  additionalProperties: false,
};
const CLAUDE_SYSTEM = `${SYSTEM}\n\n${jsonRule(OUTPUT_SCHEMA)}`;

let client: Anthropic | null = null;

type RawChange = { field: ReadyField; value: string };

// Empty lists are a real answer ("no care needs"), so they are kept; empty text is dropped.
function updatesFrom(changes: RawChange[]): ReadyUpdates {
  const updates: Record<string, unknown> = {};
  for (const change of changes) {
    const parser = PARSERS[change.field];
    const value = parser?.(String(change.value ?? ""));
    if (value !== undefined) updates[change.field] = value;
  }
  return updates as ReadyUpdates;
}

const ANSWERS = new Set(["yes", "no", "unclear"]);

export function parseReadyHeard(json: string): ReadyHeard {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return {
    answer: ANSWERS.has(String(raw.answer)) ? (raw.answer as Answer) : null,
    updates: updatesFrom(Array.isArray(raw.changes) ? (raw.changes as RawChange[]) : []),
    emergency: raw.emergency === true,
    asksAboutRide: raw.asksAboutRide === true,
    wantsRepeat: raw.wantsRepeat === true,
    wantsToEnd: raw.wantsToEnd === true,
    addressedToAgent: raw.addressedToAgent !== false,
    acknowledgment: typeof raw.acknowledgment === "string" ? raw.acknowledgment : "",
    ask: askFrom(raw.ask),
    unsure: raw.unsure === true,
  };
}

function promptFor(turn: ReadyTurnContext) {
  const history = turn.recentTurns.map((line) => `${line.speaker}: ${line.text}`).join("\n");
  return [
    `Call language: ${turn.language}. Current step: ${turn.step}.`,
    `Answers so far: ${JSON.stringify(turn.answers)}`,
    history ? `Recent turns:\n${history}` : "",
    goalsText(turn.goals),
    `Agent's last question: ${turn.question}`,
    `Resident just said: ${turn.utterance}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

function request(user: string, maxTokens = 512) {
  warm.used();
  client ??= newAnthropic();
  return client.messages.create({
    model: env.anthropicModel,
    max_tokens: maxTokens,
    system: CLAUDE_SYSTEM,
    messages: [{ role: "user", content: user }],
    ...(env.anthropicThinkingOff ? { thinking: { type: "disabled" as const } } : {}),
  });
}

const warm = warmer("Ready check", () => request(WARM_UP_TEXT, 1));
export const warmReadyInterpreter = () => warm.warm();

export const interpretReadyAnswer: ReadyInterpret = async (turn) => {
  const user = promptFor(turn);
  const claudeText = async () => jsonReply(await request(user), "Ready interpreter");
  return parseReadyHeard(await withFallback(claudeText, { system: SYSTEM, user, schema: OUTPUT_SCHEMA, maxTokens: 512 }));
};
