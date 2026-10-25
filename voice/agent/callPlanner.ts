import Anthropic from "@anthropic-ai/sdk";
import { newAnthropic } from "../anthropicClient";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Hazard } from "../../convex/hazards";

// Claude Sonnet decides who 911 calls first. It reads every home waiting for its warning call and
// ranks the most urgent ones with a short reason each. The phone calls themselves never wait on it:
// convex/callPlans.ts keeps dialing by callPriority until a plan arrives.

export const PLANNER_MODEL = "claude-sonnet-5-5";
// The same limit as MAX_PLANNED in convex/callPlans.ts, which can't be imported here without
// pulling in server-only modules. At 1 new call a second the dialer works through 40 homes in about
// a minute, so the next plan is in long before the list runs out.
const RANKED_HOMES = 40;
const MAX_REASON_WORDS = 12;
const TIMEOUT_MS = 90_000;

export type Candidate = FunctionReturnType<typeof api.callPlans.candidates>["homes"][number];
export type RankedHome = { householdId: Id<"households">; reason: string };

const HAZARD_NAME: Record<Hazard, string> = { wildfire: "fire", earthquake: "aftershock damage", flood: "flood water", hurricane: "storm" };

const systemFor = (hazard: Hazard) => `You decide the order 911 calls homes after an evacuation warning for a ${hazard}. The lines are limited: about six calls at once and one new call a second, so the first homes on your list are called within a minute and the last ones may be reached too late.

Rank up to ${RANKED_HOMES} homes that most need a call now, most urgent first. Weigh these together:
- Minutes until the ${HAZARD_NAME[hazard]} reaches the home. Fewer minutes is more urgent, and a home with 10 minutes left can't wait behind one with 60.
- need: the model's chance from 0 to 1 that the home needs help getting out.
- What we already know: a wheelchair, walker or bedbound resident, oxygen or dialysis, no car, can't leave or unsure, help needed to get out, or a Ready plan that says they need a ride.
- A home that missed calls is still unknown, not safe.
A home known to have a car and able to leave needs a call least. Never rank by address, language or name.

reason: at most ${MAX_REASON_WORDS} words in plain English, naming the facts that decided it, for example "Oxygen, no car, fire in 14 minutes."`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        properties: { home: { type: "integer" }, reason: { type: "string" } },
        required: ["home", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["ranked"],
  additionalProperties: false,
};

const known = (label: string, value: string | number | undefined) => (value === undefined ? "" : `${label} ${value}`);

// One home on one line, numbered so Claude answers with a short number instead of a database id.
export function lineFor(home: Candidate, index: number) {
  const facts = [
    `#${index + 1}`,
    `${home.minutesLeft} min left`,
    `need ${home.needProbability.toFixed(2)}`,
    home.callStatus === "no_answer" ? `missed ${home.attempts} calls` : "not called yet",
    known("people", home.peopleCount),
    known("can leave:", home.canLeave),
    home.hasCar === undefined ? "" : home.hasCar ? "has a car" : "no car",
    known("mobility", home.mobility),
    known("help to get out:", home.assistanceRequired),
    home.medical?.length ? `medical ${home.medical.join(", ")}` : "",
    known("ready plan:", home.exitPlan),
  ];
  return facts.filter((fact) => fact !== "").join(" | ");
}

export function parseRanking(text: string, homes: Candidate[]): RankedHome[] {
  const raw = JSON.parse(text) as { ranked?: { home?: unknown; reason?: unknown }[] };
  const ranked: RankedHome[] = [];
  const seen = new Set<number>();
  for (const entry of raw.ranked ?? []) {
    const index = Number(entry.home) - 1;
    const home = homes[index];
    if (!home || seen.has(index)) continue;
    seen.add(index);
    ranked.push({ householdId: home._id, reason: typeof entry.reason === "string" ? entry.reason.trim() : "" });
  }
  return ranked.slice(0, RANKED_HOMES);
}

let client: Anthropic | null = null;

export async function rankHomes(homes: Candidate[], hazard: Hazard): Promise<RankedHome[]> {
  client ??= newAnthropic({ timeout: TIMEOUT_MS });
  const response = await client.beta.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemFor(hazard),
    messages: [{ role: "user", content: `Homes waiting for their warning call:\n${homes.map(lineFor).join("\n")}` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  });
  const text = response.content.find((block) => block.type === "text");
  if (response.stop_reason !== "end_turn" || !text || text.type !== "text") {
    throw new Error(`Call planner returned no ranking (stop_reason ${response.stop_reason})`);
  }
  return parseRanking(text.text, homes);
}
