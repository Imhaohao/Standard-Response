import type { Doc } from "./_generated/dataModel";

// What the Atlassian Forge app (atlassian/door-checks/) may learn about a home on the door-check
// queue. Names and phone numbers are never part of it. Pure functions, so the route and its tests
// share one definition.

type Household = Doc<"households">;

export type DoorCheckItem = {
  householdId: string;
  rank: number;
  address: string;
  lat: number | null;
  lng: number | null;
  needLevel: "high" | "medium" | "lower";
  needSummary: string;
  language: string;
  reason: string;
  attempts: number;
  lastAttemptAt: number | null;
  statusNote: string;
};

const HIGH_NEED = 0.6;
const MEDIUM_NEED = 0.3;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 200;
export const MAX_REPORTED_IDS = 500;

const MOBILITY_WORDS: Record<NonNullable<Household["mobility"]>, string> = {
  walks: "walks without aid",
  walker: "uses a walker",
  manual_wheelchair: "uses a manual wheelchair",
  power_wheelchair: "uses a power wheelchair",
  bedbound: "is bedbound",
};

const ASSISTANCE_WORDS: Record<NonNullable<Household["assistanceRequired"]>, string> = {
  none: "needs no help to move",
  one_person_assist: "needs one person to help",
  two_person_lift: "needs a two-person lift",
};

const ESCALATION_WORDS: Record<NonNullable<Household["escalation"]>, string> = {
  address_unconfirmed: "the address was never confirmed",
  medical: "a medical emergency was flagged",
  flames: "flames were reported",
  hazard_at_home: "the hazard has reached the home",
  unservable: "no vehicle can serve the home",
  language_barrier: "the call could not be completed in the household's language",
};

export function needLevelFor(probability: number): DoorCheckItem["needLevel"] {
  if (probability >= HIGH_NEED) return "high";
  return probability >= MEDIUM_NEED ? "medium" : "lower";
}

export function needSummaryFor(home: Household): string {
  const parts: string[] = [];
  if (home.mobility) parts.push(MOBILITY_WORDS[home.mobility]);
  if (home.assistanceRequired) parts.push(ASSISTANCE_WORDS[home.assistanceRequired]);
  if (home.medical?.length) parts.push(`medical equipment: ${home.medical.join(", ")}`);
  if (home.peopleCount) parts.push(`${home.peopleCount} ${home.peopleCount === 1 ? "person" : "people"} at home`);
  return parts.length ? parts.join("; ") : "no needs on file";
}

export function reasonFor(home: Household): string {
  const tried = home.attempts === 1 ? "1 call attempt" : `${home.attempts} call attempts`;
  const why = home.escalation ? `; ${ESCALATION_WORDS[home.escalation]}` : "";
  return `Nobody reached the household after ${tried}${why}.`;
}

export function statusNoteFor(home: Household): string {
  const escalation = home.escalation ? `, flag: ${home.escalation}` : "";
  return `${home.attempts} attempts, outcome ${home.outcome}${escalation}`;
}

export function toDoorCheckItem(home: Household, rank: number): DoorCheckItem {
  return {
    householdId: home._id,
    rank,
    address: home.address,
    lat: home.lat ?? null,
    lng: home.lng ?? null,
    needLevel: needLevelFor(home.needProbability),
    needSummary: needSummaryFor(home),
    language: home.language,
    reason: reasonFor(home),
    attempts: home.attempts,
    lastAttemptAt: home.lastAttemptAt ?? null,
    statusNote: statusNoteFor(home),
  };
}

export function resolvedStatusFor(home: Household | null): string {
  if (!home) return "removed from the system";
  if (home.callStatus === "door_check") return "still on the door-check list";
  return `now ${home.callStatus.replace("_", " ")}, outcome ${home.outcome}`;
}

export type DoorChecksRequest = { limit: number; reportOn: string[] };

// A missing body means the defaults. A body that is not an object is refused.
export function parseDoorChecksRequest(body: unknown): DoorChecksRequest | null {
  if (body === undefined || body === null) return { limit: DEFAULT_LIMIT, reportOn: [] };
  if (typeof body !== "object" || Array.isArray(body)) return null;
  const { limit = DEFAULT_LIMIT, reportOn = [] } = body as Record<string, unknown>;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) return null;
  if (!Array.isArray(reportOn) || !reportOn.every((id) => typeof id === "string")) return null;
  return { limit: Math.min(limit, MAX_LIMIT), reportOn: reportOn.slice(0, MAX_REPORTED_IDS) };
}

export function parseJsonBody(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return "not json";
  }
}
