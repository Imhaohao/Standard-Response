// A judge's phone follows the house they took on the kiosk for the rest of the night. The server
// sends the facts it holds about that one house (convex/claimStatus.ts); this turns them into the one
// stage the phone shows. It runs on the phone against the night's clock, because "the fire got there
// first" is decided by the clock passing the home's fire arrival, not by any write.

export type CallState = "not_called" | "in_call" | "no_answer" | "texted" | "door_check" | "complete";

// How the household got out, and when on the night's clock: boarded a van, left with a neighbor, or
// told our agent they were driving out themselves.
export type HouseOut = { how: "ride" | "neighbor" | "self"; at: number; byFirstName: string | null };

export type RideState =
  | { state: "none" }
  | { state: "requested" }
  | { state: "coming"; by: "driver" | "neighbor"; byFirstName: string | null; etaAt: number | null };

export type HouseFacts = {
  address: string;
  residentName: string | null;
  warningIssued: boolean;
  inZone: boolean;
  callStatus: CallState;
  // Nobody was home: the resident told our agent they were somewhere else.
  away: boolean;
  fireArrivalAt: number;
  // False when the scenario's fire never reaches this home and its arrival is only a deadline.
  fireReaches: boolean;
  out: HouseOut | null;
  ride: RideState;
};

export type LiveStep = "outside_zone" | "calling" | "no_answer" | "on_call" | "door_check" | "call_done" | "ride_requested" | "ride_coming";

export type HouseStage =
  | { kind: "given_back" }
  | { kind: "waiting" }
  | { kind: "live"; step: LiveStep; minutesToFire: number | null; ride: RideState }
  | { kind: "safe"; how: HouseOut["how"] | "away"; byFirstName: string | null; minutesToSpare: number | null }
  | { kind: "spared" }
  | { kind: "lost"; rideCameLate: boolean };

const CALL_STEPS: Record<CallState, LiveStep> = {
  not_called: "calling",
  in_call: "on_call",
  no_answer: "no_answer",
  texted: "no_answer",
  door_check: "door_check",
  complete: "call_done",
};

const wholeMinutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));

function liveStepOf(facts: HouseFacts): LiveStep {
  if (facts.ride.state === "coming") return "ride_coming";
  if (facts.ride.state === "requested") return "ride_requested";
  if (!facts.inZone && facts.callStatus === "not_called") return "outside_zone";
  return CALL_STEPS[facts.callStatus];
}

// Out before the fire is safe. Boarded after the fire had already reached the home is not.
function verdictForOut(out: HouseOut, facts: HouseFacts): HouseStage {
  if (facts.fireReaches && out.at > facts.fireArrivalAt) return { kind: "lost", rideCameLate: true };
  const minutesToSpare = facts.fireReaches ? wholeMinutes(facts.fireArrivalAt - out.at) : null;
  return { kind: "safe", how: out.how, byFirstName: out.byFirstName, minutesToSpare };
}

// Before the warning nothing has happened yet, whatever the house's record says: a rewind lands here too.
export function stageOf(facts: HouseFacts | null, now: number): HouseStage {
  if (!facts) return { kind: "given_back" };
  if (!facts.warningIssued) return { kind: "waiting" };
  if (facts.away) return { kind: "safe", how: "away", byFirstName: null, minutesToSpare: null };
  if (facts.out) return verdictForOut(facts.out, facts);
  if (now >= facts.fireArrivalAt) return facts.fireReaches ? { kind: "lost", rideCameLate: false } : { kind: "spared" };
  const minutesToFire = facts.fireReaches ? wholeMinutes(facts.fireArrivalAt - now) : null;
  return { kind: "live", step: liveStepOf(facts), minutesToFire, ride: facts.ride };
}

export const isVerdict = (stage: HouseStage) => stage.kind === "safe" || stage.kind === "lost" || stage.kind === "spared";

export const firstName = (name: string | undefined | null) => name?.trim().split(/\s+/)[0] || null;
