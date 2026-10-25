import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AgentRecord, FIELDS } from "../agent/record";
import { convex } from "../convex";
import type { StreamParameters } from "./twilio";

// The household a survey or inbound call is about, shared by both voice stacks. An inbound caller
// gets a household from their number and a fresh `calls` row; a survey call arrives with both.
export async function householdCallFor(params: StreamParameters): Promise<{ householdId: Id<"households">; callId: Id<"calls"> }> {
  if (params.mode === "survey") return { householdId: params.householdId as Id<"households">, callId: params.callId as Id<"calls"> };
  const householdId = await convex().mutation(api.households.findOrCreateByPhone, { callbackNumber: params.from ?? "unknown" });
  const callId = await convex().mutation(api.calls.start, { householdId, direction: "inbound" });
  return { householdId, callId };
}

// What the agency already has on file for this home, so the agent confirms instead of asking cold.
export function onFileRecord(household: Record<string, unknown>): AgentRecord {
  const record: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (field !== "address" && household[field] !== undefined) record[field] = household[field];
  }
  return record as AgentRecord;
}
