import { HouseFacts, HouseStage, LiveStep, RideState } from "@/lib/claim-stage";

// The words for each stage on the judge's phone. The judge plays the resident, so the home is "your
// home" and the person is the resident by the name the judge gave them.

export type StageCopy = { title: string; body: string };

type Context = { resident: string; address: string; ride: RideState; minutesAway: number | null };

const awayIn = (minutes: number | null) => (minutes === null ? "" : minutes <= 1 ? " They're about a minute away." : ` They're about ${minutes} minutes away.`);

function rideComingCopy({ ride, minutesAway, resident }: Context): StageCopy {
  if (ride.state !== "coming") return { title: "A ride is on the way", body: `Help ${resident} get ready to go.` };
  const who = ride.byFirstName ?? (ride.by === "neighbor" ? "A neighbor" : "A driver");
  const verb = ride.by === "neighbor" ? "is coming to pick you up" : "accepted your ride";
  return { title: `${who} ${verb}`, body: `Help ${resident} get ready to go.${awayIn(minutesAway)}` };
}

const LIVE_COPY: Record<LiveStep, (context: Context) => StageCopy> = {
  outside_zone: () => ({ title: "The warning doesn't cover your home", body: "Our agent calls homes inside the warning first." }),
  calling: ({ resident }) => ({ title: "Our agent is calling you", body: `The warning is out. Answer as ${resident}.` }),
  no_answer: () => ({ title: "We couldn't reach you", body: "Nobody answered our call. Our agent will try again." }),
  on_call: ({ resident }) => ({ title: "You're on the call", body: `Tell our agent what ${resident} needs to get out.` }),
  door_check: () => ({ title: "A crew is coming to knock", body: "Nobody answered our calls, so a fire crew will check your door." }),
  call_done: () => ({ title: "Our agent spoke with you", body: "No ride has been requested for your home." }),
  ride_requested: () => ({ title: "Ride requested", body: "No driver has accepted yet. You'll get a call when one does." }),
  ride_coming: rideComingCopy,
};

const spare = (minutes: number | null) => (minutes === null ? "" : minutes === 1 ? " 1 minute before the fire reached your home" : ` ${minutes} minutes before the fire reached your home`);

function safeCopy(stage: Extract<HouseStage, { kind: "safe" }>, resident: string): StageCopy {
  const title = `${resident} is safe`;
  if (stage.how === "away") return { title, body: `${resident} wasn't home tonight, so no one needed a ride.` };
  if (stage.how === "self") return { title, body: `${resident} drove out${spare(stage.minutesToSpare)}.` };
  const who = stage.byFirstName ?? (stage.how === "neighbor" ? "A neighbor" : "A driver");
  return { title, body: `${who} picked ${resident} up${spare(stage.minutesToSpare)}.` };
}

export function copyFor(stage: HouseStage, facts: HouseFacts | null, minutesAway: number | null): StageCopy {
  const resident = facts?.residentName?.trim() || "The resident";
  const address = facts?.address ?? "Your house";
  if (stage.kind === "given_back") return { title: "This house was given back", body: "Your number is off it now, and our agent won't call you about it." };
  if (stage.kind === "waiting") return { title: `${address} is yours`, body: `No warning yet. When it goes out, our agent calls this phone. Answer as ${resident}.` };
  if (stage.kind === "safe") return safeCopy(stage, resident);
  if (stage.kind === "spared") return { title: "The fire passed your home", body: `It never reached the house, so ${resident} is safe.` };
  if (stage.kind === "lost") {
    const body = stage.rideCameLate ? "The fire reached your home before the ride did." : `The fire reached your home before anyone got ${resident} out.`;
    return { title: `${resident} didn't make it`, body };
  }
  return LIVE_COPY[stage.step]({ resident, address, ride: stage.ride, minutesAway });
}
