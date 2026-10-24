import { Hazard } from "../../convex/hazards";
import type { Language } from "../../convex/languages";
import { OUTLINE } from "../agent/conversation";
import { Interpretation, interpretFor, parse } from "../agent/interpreter";
import type { AgentRecord } from "../agent/record";
import type { Reading, ScriptStep, ScriptTurn } from "./bank";

// The second reader. Every scripted turn goes through the live interpreter, prompt for prompt as on a
// call (record so far, recent turns, the stage goal), and a turn enters the bank only when its reading
// means the same to the agent's code as the writer's. Run with VOICE_KNOWLEDGE=off so the bank never
// grades itself.

const HISTORY_TURNS = 6;
// Steps where the code acts on a yes or a no; elsewhere the answer field is ignored.
const YES_NO_STEPS = new Set<ScriptStep>(["confirm_address", "can_leave", "has_car", "readback", "neighbor"]);
const ADDRESS_FILLER = new Set(["north", "south", "east", "west", "n", "s", "e", "w", "street", "st", "avenue", "ave", "road", "rd", "drive", "dr"]);

// "2160 N. Lincoln Ave" and "2160 North Lincoln Avenue" are the same door.
const addressKey = (address: string) =>
  address
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !ADDRESS_FILLER.has(word))
    .join(" ");

// An empty list and a restated known address change nothing in the record.
function recordKey(updates: AgentRecord, knownAddress: string) {
  const entries = Object.entries(updates)
    .filter(([, value]) => !(Array.isArray(value) && value.length === 0))
    .map(([field, value]) => [field, field === "address" ? addressKey(String(value)) : value])
    .filter(([field, value]) => !(field === "address" && value === addressKey(knownAddress)));
  return JSON.stringify(entries.sort(([a], [b]) => String(a).localeCompare(String(b))));
}

// What a reading makes the code do: the record change, the escalation, the answer and the flags.
function meaning(heard: Interpretation, step: ScriptStep, knownAddress: string) {
  return JSON.stringify([
    recordKey(heard.updates, knownAddress),
    heard.emergency,
    YES_NO_STEPS.has(step) ? (heard.answer ?? "unclear") : "",
    heard.asksAboutRide,
    heard.wantsRepeat,
    heard.addressedToAgent,
    heard.wantsToEnd,
    heard.wantsTime,
    heard.asksWhatToDo,
    // Only the neighbor question nominates; elsewhere readers re-list a neighbor already given.
    step === "neighbor" ? heard.neighborAddresses.length > 0 : "",
  ]);
}

// An outbound call already knows the rider's address from the list.
export type CheckContext = { hazard: Hazard; language: Language; inbound: boolean; address: string };

async function agrees(turn: ScriptTurn, record: AgentRecord, history: { speaker: "agent" | "resident"; text: string }[], call: CheckContext) {
  const writer = parse(JSON.stringify(turn.reading), call.language, call.hazard);
  const reader = await interpretFor(
    {
      language: call.language,
      stage: turn.step,
      outline: OUTLINE[turn.step],
      question: turn.agent,
      record,
      recentTurns: history.slice(-HISTORY_TURNS),
      utterance: turn.resident,
    },
    call.hazard,
  );
  const known = record.address ?? "";
  return { agreed: meaning(writer, turn.step, known) === meaning(reader, turn.step, known), updates: writer.updates };
}

// One verdict per turn, in order. The record follows the writer's script either way, as the call did.
export async function secondReading(turns: ScriptTurn[], call: CheckContext): Promise<boolean[]> {
  let record: AgentRecord = call.inbound ? {} : { address: call.address };
  const history: { speaker: "agent" | "resident"; text: string }[] = [];
  const verdicts: boolean[] = [];
  for (const turn of turns) {
    const { agreed, updates } = await agrees(turn, record, history, call);
    verdicts.push(agreed);
    record = { ...record, ...updates };
    history.push({ speaker: "agent", text: turn.agent }, { speaker: "resident", text: turn.resident });
  }
  return verdicts;
}

// The feeling is named once, not on every turn ("empty when the agent named a feeling in its
// previous turn"), and stray whitespace never reaches a prompt.
export function tidyReadings(turns: ScriptTurn[]): ScriptTurn[] {
  return turns.map((turn, index) => {
    const reading: Reading = { ...turn.reading };
    for (const key of ["ack", "reply", "feeling"] as const) if (reading[key] !== undefined) reading[key] = reading[key]!.trim();
    if (index > 0 && turns[index - 1].reading.feeling) delete reading.feeling;
    return { ...turn, resident: turn.resident.trim(), reading };
  });
}
