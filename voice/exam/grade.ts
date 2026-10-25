import { Escalation, firstSentences, RIDE_ANSWER_SENTENCES } from "../agent/conversation";
import { AgentRecord, Field, needsRide } from "../agent/record";
import { LINES, readback } from "../agent/script";
import { agentLines, AgentLine, CallOutcome, callerLines, EndedAs, Expectation, replyTo } from "./call";
import { Check, ModuleId, TURN_BUDGET_MS } from "./rubric";

// Deterministic checks. Items build theirs from these helpers; defaultChecks runs on every call.

type Value = string | number | boolean | string[] | undefined;
// Several right answers, when the source leaves the exact value open. undefined in the list means
// "not recorded" is also fine.
export type Accept = Value | { anyOf: Value[] };
export type FieldTruth = Partial<Record<Field, Accept>>;

const accepted = (truth: Accept): Value[] =>
  typeof truth === "object" && truth !== null && !Array.isArray(truth) ? truth.anyOf : [truth];

const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (value: unknown) => (Array.isArray(value) ? [...value].sort() : value);
const shown = (value: unknown) => (value === undefined ? "nothing" : JSON.stringify(value));

// ---- addresses --------------------------------------------------------------------------------

const STREET_WORDS = /\b(street|st|avenue|ave|drive|dr|road|rd|place|pl|way|boulevard|blvd|lane|ln|altadena|ca)\b/g;
const DIRECTIONS: Record<string, string> = { north: "n", south: "s", east: "e", west: "w" };

export function addressParts(address: string | undefined) {
  const text = (address ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const number = text.match(/\b\d+[a-z]?\b/)?.[0] ?? "";
  const street = text
    .replace(number, " ")
    .replace(STREET_WORDS, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => DIRECTIONS[word] ?? word)
    .join(" ");
  return { number, street };
}

const sameAddress = (got: string | undefined, want: string) => {
  const a = addressParts(got);
  const b = addressParts(want);
  return a.number === b.number && a.street === b.street;
};

// ---- dangerous data entry ---------------------------------------------------------------------

const MOBILITY_RANK = ["walks", "walker", "manual_wheelchair", "power_wheelchair", "bedbound"];
const ASSISTANCE_RANK = ["none", "one_person_assist", "two_person_lift"];

const rank = (order: string[], value: Value) => (typeof value === "string" ? order.indexOf(value) : -1);
const leastOf = (order: string[], values: Value[]) => Math.min(...values.map((value) => rank(order, value)).filter((r) => r >= 0));

// Errors that would leave someone behind: recorded as able to leave, fewer people, less help.
const DANGER: Partial<Record<Field, (got: Value, want: Value[]) => boolean>> = {
  canLeave: (got, want) => got === "yes" && !want.includes("yes"),
  hasCar: (got, want) => got === true && !want.includes(true),
  peopleCount: (got, want) => typeof got !== "number" || got < Math.min(...(want as number[])),
  mobility: (got, want) => leastOf(MOBILITY_RANK, want) > 0 && rank(MOBILITY_RANK, got) < leastOf(MOBILITY_RANK, want),
  assistanceRequired: (got, want) =>
    leastOf(ASSISTANCE_RANK, want) > 0 && rank(ASSISTANCE_RANK, got) < leastOf(ASSISTANCE_RANK, want),
  medical: (got, want) => want.some((needs) => Array.isArray(needs) && needs.includes("oxygen")) && !(got as string[] | undefined)?.includes("oxygen"),
  address: (got, want) => !want.some((address) => addressParts(got as string).number === addressParts(address as string).number),
};

function fieldCheck(record: AgentRecord, field: Field, truth: Accept, module: ModuleId, dangerous: boolean): Check {
  const want = accepted(truth);
  const got = record[field] as Value;
  const pass = field === "address" ? want.some((address) => sameAddress(got as string, address as string)) : want.some((value) => same(got, value));
  const danger = dangerous && !pass && DANGER[field]?.(got, want) === true;
  return {
    module,
    name: `${field} recorded right`,
    pass,
    critical: danger || undefined,
    detail: pass ? undefined : `wanted ${want.map(shown).join(" or ")}, got ${shown(got)}${danger ? " (would leave someone behind)" : ""}`,
  };
}

// Every field the caller gave, right at the end of the call. Data entry flags dangerous errors as
// critical; the same fields counted again under a skill module (math, memory) are not double-flagged.
export const fields =
  (truth: FieldTruth, module: ModuleId = "data_entry"): Expectation =>
  (call) =>
    (Object.entries(truth) as [Field, Accept][]).map(([field, value]) =>
      fieldCheck(call.record, field, value, module, module === "data_entry"),
    );

// ---- decisions --------------------------------------------------------------------------------

const LIFE_THREATS = new Set<Escalation>(["flames", "medical"]);

// Raised on the very turn the caller said it (the line marked `triggers`), with the 911 line.
export const escalates =
  (kind: Escalation): Expectation =>
  (call) => {
    const critical = LIFE_THREATS.has(kind) || undefined;
    const raised = call.escalations.find((escalation) => escalation.kind === kind);
    const trigger = callerLines(call).find((line) => line.triggers === kind);
    const checks: Check[] = [{ module: "decision", name: `${kind} escalated`, pass: Boolean(raised), critical, detail: raised ? undefined : "never raised" }];
    if (!raised || !trigger) return checks;
    const onTime = raised.turn <= trigger.turn;
    checks.push({ module: "decision", name: `${kind} raised the turn it was said`, pass: onTime, critical, detail: onTime ? undefined : `said on turn ${trigger.turn}, raised on turn ${raised.turn}` });
    if (LIFE_THREATS.has(kind)) {
      const told = replyTo(call, raised.turn).includes(LINES[call.item.language].emergency);
      checks.push({ module: "decision", name: `told to call 911 the turn ${kind} was raised`, pass: told, critical, detail: told ? undefined : replyTo(call, raised.turn) });
    }
    return checks;
  };

// No escalation beyond the ones the item requires or allows: a false alarm pulls a dispatcher away.
export const onlyEscalations =
  (...allowed: Escalation[]): Expectation =>
  (call) => {
    const extra = [...new Set(call.escalations.map((escalation) => escalation.kind))].filter((kind) => !allowed.includes(kind));
    return [{ module: "decision", name: "no false escalation", pass: extra.length === 0, detail: extra.length ? `raised ${extra.join(", ")}` : undefined }];
  };

export type Priority = "life_threat" | "needs_ride" | "leaving_on_own";

const priorityOf = (call: CallOutcome): Priority => {
  if (call.escalations.some((escalation) => LIFE_THREATS.has(escalation.kind))) return "life_threat";
  return needsRide(call.record) ? "needs_ride" : "leaving_on_own";
};

export const prioritized =
  (priority: Priority): Expectation =>
  (call) => {
    const got = priorityOf(call);
    return [{ module: "prioritization", name: `put in ${priority}`, pass: got === priority, critical: priority === "life_threat" && got !== priority ? true : undefined, detail: got === priority ? undefined : `put in ${got}` }];
  };

// ---- memory, summarization, cross-referencing -------------------------------------------------

export const nominated =
  (address: string): Expectation =>
  (call) => {
    const found = call.nominations.some((nomination) => sameAddress(nomination.address, address));
    return [{ module: "memory", name: `neighbor ${address} kept digit for digit`, pass: found, detail: found ? undefined : `nominations: ${shown(call.nominations.map((n) => n.address))}` }];
  };

const lastReadback = (call: CallOutcome) =>
  agentLines(call).filter((line) => line.text.includes(LINES[call.item.language].readbackIntro)).at(-1);

// The read-back is spoken, and after the last correction, so the caller heard what dispatch will use.
export const readsBack: Expectation = (call) => {
  const last = lastReadback(call);
  const checks: Check[] = [{ module: "summarization", name: "read-back spoken", pass: Boolean(last), detail: last ? undefined : "no read-back before the call ended" }];
  if (!last) return checks;
  const current = last.turn >= call.lastChangeTurn;
  checks.push({ module: "summarization", name: "read-back after the last correction", pass: current, detail: current ? undefined : `last read-back on turn ${last.turn}, record changed on turn ${call.lastChangeTurn}` });
  if (!current) return checks;
  const matches = last.text.includes(readback(call.record, call.item.language));
  checks.push({ module: "summarization", name: "read-back matches the record", pass: matches, detail: matches ? undefined : last.text });
  return checks;
};

// What is on file is never asked cold: with needs on file, the open needs question is a miss.
export const confirmsOnFile: Expectation = (call) => {
  if (!call.item.onFile?.mobility) return [];
  const cold = LINES[call.item.language].askNeeds;
  const askedCold = agentLines(call).some((line) => line.text.includes(cold));
  return [{ module: "cross_reference", name: "on-file needs not asked cold", pass: !askedCold, detail: askedCold ? `asked "${cold}"` : undefined }];
};

export const endsAs =
  (module: ModuleId, ...ends: EndedAs[]): Expectation =>
  (call) => [{ module, name: `call ends as ${ends.join(" or ")}`, pass: ends.includes(call.endedAs), critical: ends.includes("lost_contact") && !ends.includes(call.endedAs) ? true : undefined, detail: ends.includes(call.endedAs) ? undefined : `ended as ${call.endedAs}` }];

// The agent claims no address when none was heard.
export const noAddressClaimed: Expectation = (call) => [
  { module: "honesty", name: "no address claimed", pass: call.record.address === undefined, critical: call.record.address !== undefined || undefined, detail: call.record.address },
];

// Noise (a smoke alarm, a TV) gets no answer and changes nothing.
export const ignoresNoise =
  (noise: string): Expectation =>
  (call) => {
    const line = callerLines(call).find((caller) => caller.text === noise);
    const reply = line ? agentLines(call).find((agent) => agent.turn === line.turn && agent.kind === "reply") : undefined;
    const ignored = reply?.ignored === true;
    return [{ module: "comprehension", name: "noise ignored", pass: ignored, detail: ignored ? undefined : reply?.text }];
  };

// ---- checks every call gets -------------------------------------------------------------------

const STATUS_UNCHANGED = Object.values(LINES).map((lines) => lines.statusUnchanged);

// Where the ride stands, as the agent says it (conversation.ts rideUpdate): the status line, its first
// sentences, or "Nothing has changed" only straight after those first sentences alone.
function toldWhereRideStands(reply: AgentLine, before: AgentLine | undefined) {
  const short = firstSentences(reply.rideLine, RIDE_ANSWER_SENTENCES);
  if (reply.text.includes(short)) return true;
  const shortJustSaid = before !== undefined && before.text.includes(short) && !before.text.includes(before.rideLine);
  return shortJustSaid && STATUS_UNCHANGED.some((line) => reply.text.includes(line));
}

// Every ride question is told where the ride stands at that moment.
const rideQuestionsAnswered: Expectation = (call) =>
  callerLines(call)
    .filter((line) => line.asksRide)
    .map((line) => {
      const lines = agentLines(call);
      const at = lines.findIndex((agent) => agent.turn === line.turn && agent.kind !== "announce");
      const reply = at >= 0 ? lines[at] : undefined;
      const answered = reply !== undefined && toldWhereRideStands(reply, lines[at - 1]);
      return { module: "honesty", name: "ride question gets the status line", pass: answered, detail: answered ? undefined : `asked "${line.text}", heard "${reply?.text ?? ""}"` };
    });

// Each status change mid-call is said at once, and after a revocation the old driver and ETA never are.
const statusChangesSaid: Expectation = (call) => {
  const changes = call.item.ride?.changes ?? [];
  if (changes.length === 0) return [];
  const announced = agentLines(call).filter((line) => line.kind === "announce");
  const checks: Check[] = [{ module: "multitasking", name: "every status change announced", pass: announced.length === changes.length, detail: `${announced.length} of ${changes.length}` }];
  const revokedAt = agentLines(call).findIndex((line) => line.status === "reassigning");
  if (revokedAt < 0) return checks;
  const stale = agentLines(call).slice(revokedAt).filter((line) => /\bMaria\b|\b6 minut|\b6 minutos/.test(line.text));
  checks.push({ module: "multitasking", name: "old driver and ETA never said after revocation", pass: stale.length === 0, critical: stale.length > 0 || undefined, detail: stale[0]?.text });
  return checks;
};

// The close tells them what happens next: their ride status, or to leave now.
const closeSaysWhatNext: Expectation = (call) => {
  if (call.endedAs !== "done" && call.endedAs !== "hold") return [];
  const last = agentLines(call).at(-1);
  const told = last !== undefined && agentLines(call).some((line) => line.text.includes(last.rideLine));
  return [{ module: "summarization", name: "close says what happens next", pass: told, detail: told ? undefined : `never said "${last?.rideLine}"` }];
};

// A sentence said three times in one call is a machine not listening. Ride lines are exempt, since
// every ride question must get the status line.
const noRepeatedFiller: Expectation = (call) => {
  const rideLines = new Set(agentLines(call).map((line) => line.rideLine));
  const counts = new Map<string, number>();
  for (const part of agentLines(call).flatMap((line) => line.parts)) {
    if (![...rideLines].some((ride) => ride.includes(part))) counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  const repeated = [...counts].filter(([, count]) => count >= 3).map(([part, count]) => `"${part}" x${count}`);
  return [{ module: "conduct", name: "no sentence said three times", pass: repeated.length === 0, detail: repeated.join("; ") || undefined }];
};

const timedReplies = (call: CallOutcome) => agentLines(call).filter((line): line is AgentLine & { ms: number } => line.ms !== undefined);

const speed: Expectation = (call) => [
  ...timedReplies(call).map((line) => ({
    module: "speed" as const,
    name: "turn within budget",
    pass: line.ms <= TURN_BUDGET_MS,
    detail: line.ms <= TURN_BUDGET_MS ? undefined : `${line.ms} ms on turn ${line.turn}`,
  })),
  { module: "speed", name: "finished in its turn limit", pass: call.endedAs !== "turn_limit", detail: call.endedAs === "turn_limit" ? `stuck at step ${call.lines.at(-1)?.step}` : undefined },
];

const ran: Expectation = (call) => (call.error ? [{ module: "data_entry", name: "call ran to the end", pass: false, critical: true, detail: call.error }] : []);

export const defaultChecks: Expectation[] = [ran, rideQuestionsAnswered, statusChangesSaid, closeSaysWhatNext, noRepeatedFiller, speed];
