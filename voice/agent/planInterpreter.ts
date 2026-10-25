import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { Hazard, hazardEscalation, HazardEscalation, HAZARDS } from "../../convex/hazards";
import { currentHazard } from "../hazard";
import { withFallback } from "./fallbackModel";
import { WARM_UP_TEXT, warmer } from "./warmUp";
import type { Answer } from "./interpreter";
import type { Language } from "./script";

// Claude's job on a pickup-check call: read one short answer to a yes-or-no question (and maybe a
// number of minutes). The state machine in planCheck.ts decides everything else.

export type PlanRole = "helper" | "resident";

export type PlanHeard = {
  answer: Answer;
  minutes: number | null;
  emergency: "none" | "medical" | HazardEscalation;
  wantsRepeat: boolean;
  addressedToAgent: boolean;
  acknowledgment: string;
  // A neighbor who wavers or raises a worry (danger, family, room in the car) rather than refusing.
  hesitant: boolean;
  // A clear refusal, or a request not to be called again: no appeal follows.
  firmNo: boolean;
};

export type PlanTurnContext = {
  language: Language;
  role: PlanRole;
  question: string;
  recentTurns: { speaker: "agent" | "resident"; text: string }[];
  utterance: string;
};

export type PlanInterpret = (turn: PlanTurnContext) => Promise<PlanHeard>;

const AT_HOME: Record<Hazard, string> = {
  wildfire: "they can see fire, flames or embers at or next to the home",
  earthquake: "someone is trapped, part of the home has collapsed, or they smell gas",
  flood: "water is coming into the home or rising around it",
  hurricane: "water is coming into the home, or the roof, walls or windows are failing",
};

const outputSchemaFor = (kind: Hazard) => ({
  type: "object",
  properties: {
    answer: { type: "string", enum: ["yes", "no", "unclear"] },
    minutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
    emergency: { type: "string", enum: ["none", "medical", hazardEscalation(kind)] },
    wantsRepeat: { type: "boolean" },
    addressedToAgent: { type: "boolean" },
    acknowledgment: { type: "string" },
    hesitant: { type: "boolean" },
    firmNo: { type: "boolean" },
  },
  required: ["answer", "minutes", "emergency", "wantsRepeat", "addressedToAgent", "acknowledgment", "hesitant", "firmNo"],
  additionalProperties: false,
});

const systemFor = (kind: Hazard) => `You interpret one thing a person just said on a short call from 911. An evacuation warning covers a neighborhood. Either we are calling a helper, asking whether they can go now and how many minutes it will take, or we are calling the resident, asking whether they will go with the helper who just said yes, or whether their helper has picked them up. The helper is someone who agreed ahead of time to pick up the resident, or a neighbor who is driving out and whom we are asking to pick the resident up on the way. You return structured data only.

- answer: yes or no to the agent's last question. "I'm on my way", "leaving now", "sure, ten minutes" are yes. "I can't", "I'm not home", "I'm out of town" are no. For "has your helper picked you up", "she's here", "I'm in the car" are yes, and "not yet", "nobody came" are no. For "will you go with them when they get there", "yes", "I'll be ready", "thank you, I'll wait by the door" are yes, and "no", "I already have a ride", "I'm already out", "I'd rather wait for the van" are no. Use unclear when you can't tell, including "maybe", "I'll try" or a question back. When the agent asked how many minutes, answer is no only if they now say they can't come after all; "I'm not sure" or "I don't know" is unclear.
- minutes: how many minutes until the helper gets there, only when the speaker says a number or a clear time ("ten minutes", "half an hour" is 30, "an hour" is 60). Null otherwise. Never guess one.
- emergency: medical if someone is hurt, can't breathe or has a medical emergency now; ${hazardEscalation(kind)} if ${AT_HOME[kind]}; otherwise none.
- wantsRepeat: true if they didn't hear or understand the question.
- addressedToAgent: false for background noise, an animal, a TV, filler alone ("um"), or talk to someone else in the room. True otherwise.
- acknowledgment: at most 5 words in the call language that show what you understood, such as "Okay, thank you." or "Alright." Empty when addressedToAgent is false or nothing fits. Never mention a driver, a vehicle, a time, minutes or that anyone is safe or coming. Never ask a question. When they waver or raise a worry, reflect the worry in their terms instead ("You've got your kids with you.", "That's a lot to ask.").
- hesitant: true when a helper wavers or raises a worry instead of answering plainly: the danger, their own family or kids in the car, room for a wheelchair, not knowing the person, "I don't know", "I'm not sure", "it's really bad out there", or a no with a reason that sounds reluctant rather than final ("I'd like to, but my kids are with me"). False for a plain yes, and for a firm no.
- firmNo: true when they clearly refuse ("No, I can't.", "Absolutely not.", "I'm already gone.", "I'm not home.") or ask not to be called again ("stop calling me", "take me off the list"). A firm no never gets talked back into anything.`;

const forEachHazard = <T>(build: (kind: Hazard) => T) =>
  Object.fromEntries(HAZARDS.map((kind) => [kind, build(kind)])) as Record<Hazard, T>;
const SYSTEM = forEachHazard(systemFor);
const OUTPUT_SCHEMA = forEachHazard(outputSchemaFor);

let client: Anthropic | null = null;

const ANSWERS = new Set(["yes", "no", "unclear"]);
const EMERGENCIES = new Set(["none", "medical", "flames", "hazard_at_home"]);

function minutesFrom(raw: unknown) {
  const minutes = Number(raw);
  return raw !== null && Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

function parse(text: string): PlanHeard {
  const raw = JSON.parse(text) as Record<string, unknown>;
  return {
    answer: ANSWERS.has(String(raw.answer)) ? (raw.answer as Answer) : "unclear",
    minutes: minutesFrom(raw.minutes),
    emergency: EMERGENCIES.has(String(raw.emergency)) ? (raw.emergency as PlanHeard["emergency"]) : "none",
    wantsRepeat: raw.wantsRepeat === true,
    addressedToAgent: raw.addressedToAgent !== false,
    acknowledgment: typeof raw.acknowledgment === "string" ? raw.acknowledgment : "",
    hesitant: raw.hesitant === true,
    firmNo: raw.firmNo === true,
  };
}

function promptFor(turn: PlanTurnContext) {
  const history = turn.recentTurns.map((line) => `${line.speaker}: ${line.text}`).join("\n");
  return [
    `Call language: ${turn.language}. We are calling the ${turn.role}.`,
    history ? `Recent turns:\n${history}` : "",
    `Agent's last question: ${turn.question}`,
    `They just said: ${turn.utterance}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

function request(kind: Hazard, user: string, maxTokens = 256) {
  warmers[kind].used();
  client ??= new Anthropic();
  return client.messages.create({
    model: env.anthropicModel,
    max_tokens: maxTokens,
    system: SYSTEM[kind],
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA[kind] } },
    ...(env.anthropicThinkingOff ? { thinking: { type: "disabled" as const } } : {}),
  });
}

const warmers = forEachHazard((kind) => warmer(`${kind} pickup check`, () => request(kind, WARM_UP_TEXT, 1)));
export const warmPlanInterpreter = (kind?: Hazard) =>
  kind ? warmers[kind].warm() : Promise.all(HAZARDS.map((each) => warmers[each].warm())).then(() => undefined);

export const interpretPlanAnswer: PlanInterpret = async (turn) => {
  const kind = currentHazard();
  const user = promptFor(turn);
  const claudeText = async () => {
    const response = await request(kind, user);
    const text = response.content.find((block) => block.type === "text");
    if (response.stop_reason === "refusal" || !text || text.type !== "text") {
      throw new Error(`Plan interpreter returned no text (stop_reason ${response.stop_reason})`);
    }
    return text.text;
  };
  return parse(await withFallback(claudeText, { system: SYSTEM[kind], user, schema: OUTPUT_SCHEMA[kind], maxTokens: 256 }));
};
