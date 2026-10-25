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

export type CallFlow = NonNullable<Doc<"calls">["flow"]>;

// A pickup or Ready call has none of the warning call's stages; it shows what it's for instead.
export function flowLabel(flow: CallFlow) {
  if (flow.kind === "ready") return "Ready check";
  if (flow.purpose === "notice") return flow.role === "helper" ? "Update to helper" : "Update to resident";
  if (flow.role === "helper") return "Asking helper";
  return flow.purpose === "confirm" ? "Confirming ride" : "Picked up?";
}

// Each call language as its speakers write it, and in English for a crew reading the house card.
const LANGUAGES: Record<string, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  es: { native: "Español", english: "Spanish" },
  zh: { native: "中文", english: "Chinese" },
  ko: { native: "한국어", english: "Korean" },
  vi: { native: "Tiếng Việt", english: "Vietnamese" },
  tl: { native: "Tagalog", english: "Tagalog" },
  ru: { native: "Русский", english: "Russian" },
  ja: { native: "日本語", english: "Japanese" },
  fr: { native: "Français", english: "French" },
  hi: { native: "हिन्दी", english: "Hindi" },
  hy: { native: "Հայերեն", english: "Armenian" },
  fa: { native: "فارسی", english: "Persian" },
};
export const languageName = (code: string) => LANGUAGES[code]?.native ?? code;
export const languageInEnglish = (code: string) => LANGUAGES[code]?.english ?? code;

export const MOBILITY_LABELS: Record<NonNullable<Doc<"households">["mobility"]>, string> = {
  walks: "Walks",
  walker: "Walker",
  manual_wheelchair: "Manual wheelchair",
  power_wheelchair: "Power wheelchair",
  bedbound: "Bedbound",
};

export const CAN_LEAVE_LABELS = { yes: "Yes", no: "No", unsure: "Unsure" } as const;

export type RequestStatus = Doc<"requests">["status"];
export type AssignmentStatus = Doc<"assignments">["status"];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  received: "Waiting for a driver",
  approved: "Offer sent",
  driver_accepted: "Driver accepted",
  en_route: "Driver on the way",
  reassigning: "Finding a new driver",
  arrived: "Picked up",
  closed: "Closed",
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  proposed: "Waiting for approval",
  offered: "Offered to driver",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  replaced: "Replaced by a newer plan",
  revoked: "Revoked",
  completed: "Picked up",
};

export const ESCALATION_LABELS: Record<NonNullable<Doc<"households">["escalation"]>, string> = {
  address_unconfirmed: "Address not confirmed",
  medical: "Medical emergency",
  flames: "Sees flames",
  hazard_at_home: "Danger at the home now",
  unservable: "No vehicle can reach in time",
  language_barrier: "Needs an interpreter or a visit",
};

type Load = Doc<"requests">["load"];

// "2 seats, 1 wheelchair, crew of 2"
export function needsSummary(load: Load, crewNeeded: number) {
  const parts = [
    load.seats > 0 && `${load.seats} seat${load.seats === 1 ? "" : "s"}`,
    load.wheelchairSpaces > 0 && `${load.wheelchairSpaces} wheelchair`,
    load.stretcherSpaces > 0 && `${load.stretcherSpaces} stretcher`,
    crewNeeded > 1 && `crew of ${crewNeeded}`,
  ].filter(Boolean);
  return parts.join(", ");
}

export function capacitySummary(vehicle: Pick<Doc<"vehicles">, "seats" | "wheelchairSpaces" | "stretcherSpaces" | "crewSize">) {
  return `Fits ${needsSummary(vehicle, vehicle.crewSize)}`;
}

// "+16265550142" as people write it: "(626) 555-0142". Anything else is shown as stored.
export function phoneForPeople(number: string) {
  const digits = number.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return number;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
