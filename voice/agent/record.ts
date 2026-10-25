import type { RecordPatch } from "../../convex/households";

// The structured record the agent fills during a call. Same shape as `households:update`.
export type AgentRecord = Omit<RecordPatch, "language">;
export type Field = keyof AgentRecord;
export type Confidence = Partial<Record<Field, number>>;

export const FIELDS: Field[] = [
  "address",
  "canLeave",
  "hasCar",
  "peopleCount",
  "pets",
  "mobility",
  "medical",
  "assistanceRequired",
  "away",
];

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Only the fields that changed, so the contract logs a correction exactly when one happened.
export function changedFields(before: AgentRecord, patch: AgentRecord): AgentRecord {
  const changed: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const value = patch[field];
    if (value !== undefined && !sameValue(before[field], value)) changed[field] = value;
  }
  return changed as AgentRecord;
}

export const isEmpty = (record: AgentRecord) => Object.keys(record).length === 0;

const LIMITED_MOBILITY = new Set(["walker", "manual_wheelchair", "power_wheelchair", "bedbound"]);

export const hasLimitedMobility = (record: AgentRecord) =>
  record.mobility !== undefined && LIMITED_MOBILITY.has(record.mobility);

// Mirrors `outcomeFor` in convex/model.ts: does this home need a vehicle from us?
export function needsRide(record: AgentRecord) {
  if (hasLimitedMobility(record) || record.medical?.includes("oxygen")) return true;
  if (record.canLeave === "no" || record.canLeave === "unsure") return true;
  return record.canLeave === "yes" && record.hasCar === false;
}
