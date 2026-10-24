import type { AgentRecord } from "../record";

type Mobility = NonNullable<AgentRecord["mobility"]>;
type Assistance = NonNullable<AgentRecord["assistanceRequired"]>;

export type VehicleKind = "stretcher_van" | "wheelchair_van" | "paratransit" | "bus" | "fire_unit" | "ambulance";

// Every sentence the agent may say in one language, apart from Claude's short acknowledgment.
// Ride lines are templates filled only from the confirmed assignment: never an ETA Claude wrote.
export type Lines = {
  greetOutbound: (address: string, name?: string) => string;
  greetInbound: string;
  greetCallback: (name?: string) => string;
  askAddress: string;
  askHouseNumber: (street: string) => string;
  confirmAddress: (address: string) => string;
  addressRetry: string;
  addressEscalated: string;
  askCanLeave: string;
  askHasCar: string;
  askHousehold: string;
  askNeeds: string;
  askNeedsOnFile: (onFile: string) => string;
  askAssistance: string;
  readbackIntro: string;
  readbackQuestion: string;
  readbackFixed: string;
  whatToFix: string;
  askNeighbor: string;
  leaveNow: string;
  goodbye: string;
  repeatPrompt: string;
  emergency: string;
  // Said once when nobody can understand each other; the call then ends and a person follows up.
  languageBarrier: string;
  voicemail: string;
  people: (count: number) => string;
  pets: string;
  noCar: string;
  leavingOnOwn: string;
  byCar: string;
  mobility: Record<Mobility, string>;
  assistance: Record<Assistance, string>;
  oxygen: string;
  atAddress: (address: string) => string;
  // Joins read-back parts; the result is capitalized and wrapped by readbackIntro and readbackQuestion.
  listSeparator: string;
  // Ends the read-back summary. Defaults to ".".
  sentenceEnd?: string;
  textPrompt: string;
  textThanks: string;
  // Fills a pause while Claude is thinking. Must not acknowledge any content.
  backchannels: string[];
  // Replaces an acknowledgment the honesty guard blocks.
  neutralAck: string;
  waiting: string;
  reassigning: string;
  vehicle: Record<VehicleKind, string>;
  // Only called for a crew of two or more.
  crew: (size: number) => string;
  minutes: (count: number) => string;
  accepted: (vehicle: string, crew: string, eta: string, driverName: string) => string;
  enRoute: (driverName: string, eta: string) => string;
  arrived: (shelterName?: string) => string;
};
