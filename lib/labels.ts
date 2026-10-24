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

const LANGUAGES: Record<string, string> = { en: "English", es: "Español" };
export const languageName = (code: string) => LANGUAGES[code] ?? code;

export const MOBILITY_LABELS: Record<NonNullable<Doc<"households">["mobility"]>, string> = {
  walks: "Walks",
  walker: "Walker",
  manual_wheelchair: "Wheelchair",
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
  unservable: "No vehicle can reach in time",
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
