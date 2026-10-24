import { Doc } from "@/convex/_generated/dataModel";

export type Outcome = Doc<"households">["outcome"];
export type Stage = Doc<"calls">["stage"];
export type CallStatus = Doc<"households">["callStatus"];

// Order matters: it is the order outcomes appear everywhere on screen.
export const OUTCOMES: { key: Exclude<Outcome, "unknown">; label: string; colorVar: string }[] = [
  { key: "needs_accessible", label: "Needs accessible vehicle", colorVar: "var(--accessible)" },
  { key: "needs_ride", label: "Needs a ride", colorVar: "var(--ride)" },
  { key: "leaving", label: "Leaving on their own", colorVar: "var(--leaving)" },
  { key: "unreachable", label: "Unreachable", colorVar: "var(--unreachable)" },
];

export function outcomeColor(outcome: Outcome) {
  return OUTCOMES.find((o) => o.key === outcome)?.colorVar ?? "var(--unknown)";
}

export const STAGES: { key: Stage; label: string }[] = [
  { key: "greet", label: "Greet" },
  { key: "confirm_address", label: "Address" },
  { key: "can_leave", label: "Can leave" },
  { key: "household", label: "Household" },
  { key: "needs", label: "Needs" },
  { key: "readback", label: "Read back" },
  { key: "close", label: "Close" },
];

export const stageIndex = (stage: Stage) => STAGES.findIndex((s) => s.key === stage);

const LANGUAGES: Record<string, string> = { en: "English", es: "Español", zh: "中文" };
export const languageName = (code: string) => LANGUAGES[code] ?? code;

export const MOBILITY_LABELS: Record<NonNullable<Doc<"households">["mobility"]>, string> = {
  walks: "Walks",
  walker: "Walker",
  manual_wheelchair: "Wheelchair",
  power_wheelchair: "Power wheelchair",
  bedbound: "Bedbound",
};

export const CAN_LEAVE_LABELS = { yes: "Yes", no: "No", unsure: "Unsure" } as const;
