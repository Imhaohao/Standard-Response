import type { Hazard } from "../../../convex/hazards";
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
  addressEscalated: string;
  // The same hand-off to a dispatcher when no address was heard at all, so we never claim one.
  addressMissing: string;
  askCanLeave: string;
  askHasCar: string;
  askHousehold: string;
  // The household question once pets are already known.
  askPeople: string;
  askNeeds: string;
  // The needs question once mobility was already heard on this call: only oxygen is left to ask.
  askOxygen: string;
  askNeedsOnFile: (onFile: string) => string;
  askAssistance: string;
  // Asked when someone said "wheelchair" without saying which kind. A yes means a power chair: a
  // battery chair can weigh 400 pounds and won't fit in a neighbor's car.
  askChairKind: string;
  readbackIntro: string;
  // Opens the read-back when everything in it came from the Ready check, before anything is asked again.
  readbackOnFileIntro: string;
  readbackQuestion: string;
  readbackFixed: string;
  whatToFix: string;
  askNeighbor: string;
  // Each question again in other words, after an answer that didn't answer it or a silence, so the
  // resident never hears the same sentence twice in a row unless they asked for it.
  askAgain: {
    address: string;
    houseNumber: (street: string) => string;
    confirmAddress: (address: string) => string;
    canLeave: string;
    hasCar: string;
    household: string;
    needs: string;
    assistance: string;
    chairKind: string;
    readback: string;
    fix: string;
    neighbor: string;
  };
  // Check-ins when the line goes quiet after a question, used in turn before the question again.
  // The second ("Hello? I'm still on the line.") also answers a caller checking the line on hold.
  stillThere: string[];
  // Asked about the fire or the way out when the 911 screen has nothing to say: the honest answer.
  notKnownYet: string;
  // The resident asked for a moment ("hold on, let me ask my wife"): the agent waits.
  takeYourTime: string;
  // Said after several quiet check-ins in a row. The call ends and the reach ladder calls back.
  // Always followed by the current hazard's safety line.
  lostYou: string;
  // Said back when the resident names someone else who may not be able to leave.
  passedOn: (place: string) => string;
  // Said after passing on a neighbor who is dying, hurt or can't breathe right now.
  neighborUrgent: string;
  // The answer to a plea for help before any address is known: there is no request yet.
  needAddress: string;
  leaveNow: string;
  // Anyone who needs a ride stays on the line after the questions, so a driver's acceptance can be
  // said live. holdPrompt is said once.
  holdPrompt: string;
  // What a resident waiting for a ride can do meanwhile, one at a time: when they ask what to do,
  // and when the line goes quiet on hold. Never a promise that anyone is coming.
  holdSteps: string[];
  // Said in place of the status line when the resident heard it in the last few turns and it hasn't
  // changed, so a second "when are you coming?" isn't answered with the whole template again.
  statusUnchanged: string;
  goodbye: string;
  // The resident isn't at the home and nobody else is: no ride goes there and the call ends. It never
  // says they are safe; the agent can't know that.
  awaySafe: string;
  // Asked before a home is marked empty, because that calls off its ride. "We just walked outside"
  // and "I'm in the car, he's at our house" were both read as nobody home.
  confirmAway: string;
  confirmAwayAgain: string;
  // A language switch plays as a hand-off between two agents: transferOut in the old language and
  // voice, a short pause, then transferIn in the new one before the conversation picks back up.
  transferOut: string;
  transferIn: string;
  repeatPrompt: string;
  // Said once when a life threat is raised and Claude named no feeling of its own.
  frightening: string;
  emergency: string;
  // Said once when nobody can understand each other; the call then ends with the household flagged.
  // It says only that a person was told, never that the call is being transferred.
  // languageBarrier, waiting, reassigning and lostYou are always followed by the current hazard's safety line.
  languageBarrier: string;
  voicemail: string;
  people: (count: number) => string;
  pets: string;
  noPets: string;
  // Said back when an answer gives can-leave or a car, like the other fact echoes.
  leaveEcho: Record<"yes" | "no" | "unsure", string>;
  hasCarEcho: string;
  noCar: string;
  leavingOnOwn: string;
  byCar: string;
  mobility: Record<Mobility, string>;
  assistance: Record<Assistance, string>;
  oxygen: string;
  dialysis: string;
  otherMedical: string;
  noMedical: string;
  atAddress: (address: string) => string;
  // Someone leaving on their own may already be on the road, so the read-back says where they leave from.
  fromAddress: (address: string) => string;
  // Joins read-back parts; the result is capitalized and wrapped by readbackIntro and readbackQuestion.
  listSeparator: string;
  // Ends the read-back summary. Defaults to ".".
  sentenceEnd?: string;
  // Space between two whole sentences. Defaults to " "; Chinese and Japanese use none.
  sentenceGap?: string;
  textPrompt: string;
  textThanks: string;
  // Fills a pause while Claude is thinking. It plays before we know whether the resident answered
  // (or a dog barked), so it must not claim to have understood anything: no "got it".
  backchannels: string[];
  // Replaces an acknowledgment the honesty guard blocks.
  // The ride need is known but no request exists yet (the call is still writing it), so nothing
  // claims one was placed.
  waitingForRequest: string;
  waiting: string;
  reassigning: string;
  // What to do if the hazard reaches the home before a driver does.
  safety: Record<Hazard, string>;
  vehicle: Record<VehicleKind, string>;
  // Only called for a crew of two or more.
  crew: (size: number) => string;
  minutes: (count: number) => string;
  accepted: (vehicle: string, crew: string, eta: string, driverName: string) => string;
  enRoute: (driverName: string, eta: string) => string;
  arrived: (shelterName?: string) => string;
  // Opens the agent's next turn after the resident really talked over it, never in front of an
  // emergency or safety line. Short, since it rides in the same request as the answer.
  apologyAfterCutOff: string;
};
