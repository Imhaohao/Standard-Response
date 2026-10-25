import { newAnthropic } from "../anthropicClient";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { HAZARDS, type Hazard } from "../../convex/hazards";
import type { Language } from "../../convex/languages";
import { guardAcknowledgment } from "../agent/honesty";
import { CALL_TAKER_PRINCIPLES, OUTPUT_SCHEMA, parse, SYSTEM } from "../agent/interpreter";
import { FIELDS } from "../agent/record";
import { LINES } from "../agent/script";
import { BANK_FILES, PrincipleCard, Reading, Script, SCRIPT_STEPS, ScriptStep, ScriptTurn } from "./bank";
import { secondReading, tidyReadings } from "./checker";
import { realCallerLines, Seed, seedFor } from "./seeds";

// Builds the two files Moss indexes (voice/knowledge/upload.ts), with Claude Haiku as the writer and
// the agent itself as the checker: every reading must survive the interpreter's parser, every spoken
// line the honesty guard, and the live interpreter must read the turn the same way (checker.ts), or
// the turn is dropped.
//
//   npm run knowledge:generate -- principles        the principles database
//   npm run knowledge:generate -- scripts 3000      the 911 dialog bank (resumes where it stopped)

const WRITER_MODEL = "claude-haiku-5-5";
const CONCURRENCY = 32;
const CARDS_PER_PRINCIPLE_AND_HAZARD = 10;
const MIN_CHECKED_TURNS = 3;

const client = newAnthropic({ maxRetries: 8 });

const objectOf = (properties: Record<string, object>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const text = { type: "string" };

async function structured<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
  const response = await client.messages.create({
    model: WRITER_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema } },
  });
  const block = response.content.find((part) => part.type === "text");
  if (response.stop_reason === "refusal" || !block || block.type !== "text") {
    throw new Error(`Writer returned no text (stop_reason ${response.stop_reason})`);
  }
  return JSON.parse(block.text) as T;
}

async function pooled<T>(jobs: T[], run: (job: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await run(jobs[next++]);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// A line Claude would speak, held to the same guard as on a live call before any ride is confirmed.
const speakable = (line: string | undefined, language: Language) =>
  !line || !guardAcknowledgment(line, "none", language).blocked;

// ---- Principles ----

const CARDS_SCHEMA = objectOf({
  cards: {
    type: "array",
    items: objectOf({ situation: text, callerSaysEn: text, callerSaysEs: text, guidance: text, exampleLine: text }),
  },
});

type DraftCard = { situation: string; callerSaysEn: string; callerSaysEs: string; guidance: string; exampleLine: string };

const PRINCIPLES_SYSTEM = `You expand the constitution of an automated 911 evacuation assistant into concrete situations. The assistant calls residents who may not be able to leave on their own (paratransit riders, people with disabilities, older adults), finds out what help they need, and never promises outcomes; code decides what may be promised. Its full interpreter instructions:

<interpreter_instructions>
${SYSTEM.wildfire}
</interpreter_instructions>

Each card is one situation where a given principle decides what the assistant should say. situation: one sentence naming what the caller does or says. callerSaysEn and callerSaysEs: one realistic thing a caller would say there, in English and in Spanish, as speech-to-text would write it. guidance: one or two sentences on what the assistant does and what it must not do. exampleLine: what the assistant says, at most 20 words, following every rule above (no promise of help or timing, no invented facts, no advice beyond the fixed lines, no "okay" opener).`;

async function cardsFor(principle: (typeof CALL_TAKER_PRINCIPLES)[number], hazard: Hazard): Promise<PrincipleCard[]> {
  const prompt = `Principle ${principle.id}: ${principle.text}\nHazard: ${hazard}.\nWrite ${CARDS_PER_PRINCIPLE_AND_HAZARD} distinct cards, from common to rare situations, that a ${hazard} evacuation call would actually meet.`;
  const { cards } = await structured<{ cards: DraftCard[] }>(PRINCIPLES_SYSTEM, prompt, CARDS_SCHEMA);
  return cards
    .filter((card) => speakable(card.exampleLine, "en"))
    .map((card, index) => ({
      id: `${principle.id}-${hazard}-${index}`,
      principle: principle.id,
      hazard,
      situation: card.situation,
      callerSays: { en: card.callerSaysEn, es: card.callerSaysEs },
      guidance: card.guidance,
      exampleLine: card.exampleLine,
    }));
}

// The constitution itself is the first card of each principle, for any hazard.
const constitutionCards = (): PrincipleCard[] =>
  CALL_TAKER_PRINCIPLES.map((principle) => ({
    id: `${principle.id}-any-0`,
    principle: principle.id,
    hazard: "any",
    situation: principle.text,
    callerSays: { en: "", es: "" },
    guidance: principle.text,
    exampleLine: "",
  }));

async function generatePrinciples() {
  const cards = constitutionCards();
  const jobs = CALL_TAKER_PRINCIPLES.flatMap((principle) => HAZARDS.map((hazard) => ({ principle, hazard })));
  await pooled(jobs, async ({ principle, hazard }) => {
    const drawn = await cardsFor(principle, hazard).catch((error: unknown) => {
      console.error(`[principles] ${principle.id} / ${hazard} failed`, error instanceof Error ? error.message : error);
      return [];
    });
    cards.push(...drawn);
    console.log(`[principles] ${principle.id} / ${hazard}: ${cards.length} cards`);
  });
  mkdirSync(dirname(BANK_FILES.principles), { recursive: true });
  writeFileSync(BANK_FILES.principles, cards.map((card) => JSON.stringify(card)).join("\n") + "\n");
  console.log(`Wrote ${cards.length} principle cards to ${BANK_FILES.principles}`);
}

// ---- Dialog bank ----

const scriptSchemaFor = (hazard: Hazard) =>
  objectOf({
    persona: text,
    turns: { type: "array", items: objectOf({ step: { type: "string", enum: SCRIPT_STEPS }, agent: text, resident: text, reading: OUTPUT_SCHEMA[hazard] }) },
  });

function stepGuide(seed: Seed) {
  const lines = LINES[seed.language];
  return [
    `- confirm_address: "${lines.confirmAddress(seed.address)}". An outbound call's first agent line is the greeting "${lines.greetOutbound(seed.address)}", at this step.`,
    `- ask_address: "${lines.askAddress}". An inbound call's first agent line is "${lines.greetInbound} ${lines.askAddress}".`,
    `- can_leave: "${lines.askCanLeave}"`,
    `- has_car: "${lines.askHasCar}" Only when they can leave.`,
    `- household: "${lines.askHousehold}"`,
    `- needs: "${lines.askNeeds}"`,
    `- assistance: "${lines.askAssistance}" Only when someone uses a walker or a wheelchair or is bedbound.`,
    `- readback: "${lines.readbackIntro} <the record in plain words> ${lines.readbackQuestion}"`,
    `- fix: "${lines.whatToFix}" After a no at the readback; the readback follows again.`,
    `- neighbor: "${lines.askNeighbor}"`,
    `- hold: "${lines.holdPrompt}" When they need a ride, the agent stays on the line; the resident may ask questions, plead or go quiet.`,
  ].join("\n");
}

const scriptSystemFor = (hazard: Hazard) => `You write practice calls for an automated 911 evacuation assistant, together with the exact reading its interpreter should give each resident turn. The interpreter's full instructions follow. Every reading you write must be exactly what an interpreter that follows them perfectly would return for that turn, given the record so far.

<interpreter_instructions>
${SYSTEM[hazard]}
</interpreter_instructions>

The agent's code asks its questions in this order, skipping what the record already answers. When a reading has an emergency, the code marks the call urgent for a dispatcher: end the script within two turns. A goodbye ends it. Write 6 to 14 turns; each turn is one agent line and the resident's answer to it.

Resident lines sound like a real person on the phone in a crisis, as speech-to-text writes them: fragments, fillers, run-ons, self-corrections. The real 911 caller excerpt sets the voice and rhythm only; never reuse its facts. persona: one sentence describing the caller.`;

function scriptPrompt(seed: Seed) {
  return [
    `Hazard: ${seed.hazard}. Call language: ${seed.language} (write every agent and resident line in it). ${seed.inbound ? "Inbound call: the resident called in." : "Outbound call: the agent called the resident."}`,
    `Questions, step by step:\n${stepGuide(seed)}`,
    `Caller: ${seed.caller}, ${seed.mood}. Address: ${seed.address}. Household: ${seed.household}.`,
    `What happens on this call: ${seed.twists.join("; ")}.`,
    `Real 911 caller excerpt, for voice only:\n${seed.callerExcerpt.map((line) => `> ${line}`).join("\n")}`,
  ].join("\n\n");
}

// The questions the code asks word for word; the bank keeps them exact, since the live search
// pairs the agent's real question with the resident's words.
function fixedQuestion(step: ScriptStep, language: Language): string | undefined {
  const lines = LINES[language];
  const fixed: Partial<Record<ScriptStep, string>> = {
    can_leave: lines.askCanLeave,
    has_car: lines.askHasCar,
    household: lines.askHousehold,
    needs: lines.askNeeds,
    assistance: lines.askAssistance,
    fix: lines.whatToFix,
    neighbor: lines.askNeighbor,
  };
  return fixed[step];
}

const setFields = (reading: Reading) => new Set(reading.set.map((change) => change.split("=")[0].trim()));

// A reading the interpreter's own parser accepts whole, with spoken words the guard lets through.
function readingHolds(reading: Reading, seed: Seed) {
  const parsed = parse(JSON.stringify(reading), seed.language, seed.hazard);
  const fields = setFields(reading);
  const everyChangeParsed = Object.keys(parsed.updates).length === fields.size && reading.set.length === fields.size;
  const onlyKnownFields = [...fields].every((field) => (FIELDS as string[]).includes(field));
  return everyChangeParsed && onlyKnownFields && [reading.ack, reading.reply, reading.feeling].every((line) => speakable(line, seed.language));
}

async function checkedTurns(drafted: ScriptTurn[], seed: Seed): Promise<ScriptTurn[]> {
  const turns = tidyReadings(drafted)
    .filter((turn) => turn.resident !== "")
    .map((turn) => ({ ...turn, agent: fixedQuestion(turn.step, seed.language) ?? turn.agent }));
  const agreed = await secondReading(turns, seed);
  return turns.map((turn, index) => ({ ...turn, checked: agreed[index] && readingHolds(turn.reading, seed) }));
}

async function writeScript(seed: Seed): Promise<Script | null> {
  const draft = await structured<{ persona: string; turns: ScriptTurn[] }>(scriptSystemFor(seed.hazard), scriptPrompt(seed), scriptSchemaFor(seed.hazard));
  const turns = await checkedTurns(draft.turns, seed);
  const checked = turns.filter((turn) => turn.checked).length;
  console.log(`[scripts] ${seed.id}: ${checked} of ${turns.length} turns checked`);
  if (checked < MIN_CHECKED_TURNS) return null;
  return { id: seed.id, hazard: seed.hazard, language: seed.language, persona: draft.persona, twists: seed.twists, seedCall: seed.seedCall, turns };
}

const writtenIds = () =>
  existsSync(BANK_FILES.scripts)
    ? new Set(readFileSync(BANK_FILES.scripts, "utf8").split("\n").filter(Boolean).map((line) => (JSON.parse(line) as Script).id))
    : new Set<string>();

async function generateScripts(count: number) {
  const calls = await realCallerLines();
  const done = writtenIds();
  const seeds = Array.from({ length: count }, (_, index) => seedFor(index, calls)).filter((seed) => !done.has(seed.id));
  mkdirSync(dirname(BANK_FILES.scripts), { recursive: true });
  const tally = { kept: done.size, rejected: 0, failed: 0 };
  await pooled(seeds, async (seed) => {
    const script = await writeScript(seed).catch((error: unknown) => {
      tally.failed++;
      console.error(`[scripts] ${seed.id} failed`, error instanceof Error ? error.message : error);
      return undefined;
    });
    if (script) appendFileSync(BANK_FILES.scripts, `${JSON.stringify(script)}\n`);
    if (script) tally.kept++;
    if (script === null) tally.rejected++;
    console.log(`[scripts] ${seed.id}: ${tally.kept} kept, ${tally.rejected} rejected by the checks, ${tally.failed} failed`);
  });
}

async function main() {
  const [what, count] = process.argv.slice(2);
  if (what === "principles") return generatePrinciples();
  if (what === "scripts") return generateScripts(Number(count ?? 3000));
  throw new Error("Usage: npm run knowledge:generate -- principles | scripts [count]");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
