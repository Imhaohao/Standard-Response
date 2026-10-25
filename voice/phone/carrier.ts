import { env } from "../env";
import type { StreamParameters } from "./callParameters";
import { cancelCartesiaCall, placeCartesiaCall } from "./cartesiaCalls";
import { hangUp, placeCall as placeTwilioCall } from "./twilio";

// The phone system VOICE_CARRIER picks, for everything that places or cancels a call.

export function placeCall(to: string, parameters: StreamParameters) {
  return env.carrier === "cartesia" ? placeCartesiaCall(to, parameters) : placeTwilioCall(to, parameters);
}

// Hangs up a call that is still ringing.
export function hangUpRinging(callSid: string) {
  return env.carrier === "cartesia" ? cancelCartesiaCall(callSid) : hangUp(callSid);
}
