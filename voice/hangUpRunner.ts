import { api } from "../convex/_generated/api";
import { convex, logSubscriptionError } from "./convex";
import { callSidByCallId, liveByCallSid, onCallEnded } from "./phone/registry";
import { hangUpRinging } from "./phone/carrier";

// Hangs up the calls the call floor asked to end (calls:requestHangUp), from our side. A call on
// the line ends through its session, so it's recorded as answered; one still ringing is cancelled
// through the carrier, and its miss is reported as unanswered, as any ring nobody picked up.

export function startHangUpRunner() {
  const handled = new Set<string>();

  function hangUpCall(callId: string) {
    const callSid = callSidByCallId.get(callId);
    if (!callSid || handled.has(callId)) return;
    handled.add(callId);
    const live = liveByCallSid.get(callSid);
    console.log(`[hang-up] the call floor ended call ${callId}`);
    void (live ? live.hangUpNow() : hangUpRinging(callSid));
  }

  convex().onUpdate(api.calls.hangUpRequests, {}, (callIds) => {
    for (const callId of callIds) hangUpCall(callId);
  }, logSubscriptionError("calls.hangUpRequests"));
  onCallEnded((ended) => {
    if (!ended.callId) return;
    callSidByCallId.delete(ended.callId);
    handled.delete(ended.callId);
  });
  console.log("[hang-up] watching for calls the call floor ends");
}
