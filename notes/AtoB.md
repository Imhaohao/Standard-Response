# Notes from Track A to Track B

## 2026-10-24 01:47

- New screens are up: `/map` (rescue map), `/driver`, `/phone` (simulated texts), `/system` (under the hood). They're functional only; styling comes later.
- I added two read-only queries to tables you place calls on: `texts:threads` and `callbacks:recent`. Nothing you write changed.
- Request: put per-turn latency somewhere I can read it, for example an optional `latencyMs` on agent lines in `transcriptLines`. `/system` will show p50 and p95 from it.
- Riders imported from the CSV are `simulated: false`, so the voice stand-in never calls them. They wait in `households:queue` for your real dialer.
- For the demo script: the driver page has a "Hold offers until I tap" checkbox. With it on, an offer the plan replaced stays tappable, so the late Accept is rejected live ("This assignment changed"). With it off, the card flips to changed on its own.
- `/present` can reuse `PageShell`, `MapView` from `components/rescue/map-view.tsx`, and `PlanSummary`.

## 2026-10-24 11:55

- On `oceanic-panda-520`, the household at 149 Mariposa St texted "HELP IM DYING" and "IM DYING!!!!" (11:15) after five "2" replies, and nothing reacted: no escalation, no call, no reply text. Free-text inbound texts that aren't 1, 2 or 3 look unhandled in `voice/textFollowUp.ts`. Could a non-digit reply escalate the household (`medical`, or a new kind) and queue a call back? The simulated phone screen now marks threads whose last message is free text in red so a dispatcher can see them, but the record should change too.

## 2026-10-24 13:10

Heads-up before you start anything new: Boris asked for a Ready check and a pickup check, and asked me to build all of it, voice included. The plan is in PLAN.md under "Ready check and pickup check". What touches your code:

- **New call modes on the voice server.** `plan_check` (call a prearranged helper: "can you pick up Walter now?", then later the resident: "has Ana picked you up?") and `ready` (the census call ahead of any warning). They live in new files: `voice/agent/planCheck.ts`, `voice/agent/readyCall.ts`, `voice/pickupRunner.ts`, `voice/readyDialer.ts`. The edits to your files are small: a branch in `CallSession.begin` and `finish`, two more `CallMode` values in `phone/twilio.ts` and `phone/registry.ts`, and starting the two runners in `server.ts`. If you're mid-change in `callSession.ts`, tell me in BtoA and I'll rebase around you.
- **New household field `ready`** (owned by A): `{ at, via, exitPlan, bedroom?, care, note? }`. Your record fields are unchanged. The Ready check fills `peopleCount`, `mobility`, `assistanceRequired`, `medical`, `pets` and `hasCar` ahead of time without touching `outcome`, so the evening call confirms them as "on file" the way it already does for rider-list mobility.
- **New table `pickupPlans`.** You report call results through `pickups:startAttempt`, `pickups:helperAnswered`, `pickups:residentAnswered` and `pickups:unanswered`. The queue is `pickups:callQueue`.
- Plan-check and Ready check calls don't create `calls` rows, so the call floor's line counts stay about the night. They log to `events`.

## 2026-10-24 14:05

The pickup check and Ready check calls are in `voice/` now. What changed in your files, all small:

- `phone/callSession.ts`: `conversation` is typed as the new `CallFlow` interface (`agent/callFlow.ts`; your `Conversation` already satisfies it unchanged). `begin()` has one branch to `beginOutboundFlow()` for `plan_check` and `ready`. `onMachine` uses a flow's own voicemail when it has one, and `finish()` calls the flow's optional `lineClosed()` and passes `householdId`, `planId` and `role` to `callEnded`.
- `phone/twilio.ts` and `phone/registry.ts`: two more `CallMode` values, plus `planId` and `role` on the stream parameters and the status-callback query.
- `server.ts`: unanswered `plan_check` and `ready` calls report through `reportUnreached()`, and `startPickupRunner()` and `startReadyDialer()` start next to the callback runner.
- New files: `agent/planCheck.ts`, `agent/planInterpreter.ts`, `agent/readyCall.ts`, `agent/readyInterpreter.ts`, `phone/outboundFlows.ts`, `pickupRunner.ts`, `readyDialer.ts`, and a test (`npx tsx --test voice/agent/planCheck.test.ts`, 15 pass).
- Both runners respect `DIAL_ALLOWLIST`. The pickup runner only dials while `control.dialerRunning` is on; the Ready dialer only while a Ready check campaign runs and no warning is out.
- None of it has been dialed through real Twilio or Cartesia yet; it's checked with stubbed interpreters only. Lines are English and Spanish, and other languages fall back to English. When you redeploy Fly, these go out too. Please try one helper call to your own phone.

## 2026-10-24 15:00

The agent now speaks as 911, and it asks neighbors to pick people up. Both changes are in your files.

- Identity: every greeting, voicemail and text prompt says "this is 911", in all 9 languages (`agent/lines/*.ts`, `planCheck.ts`, `readyCall.ts`). Nothing tells a resident to "call 911" any more. The safety lines and `addressEscalated` / `addressMissing` say "call this number back" instead, and `emergency` says the dispatcher has the call. Exception: the Ready check's `emergency` still says to hang up and dial 911, because that pre-season call has no way to escalate.
- `interpreter.ts`: three identity lines only (honest_about_automation, life_threats_first, and the `reply` example). I committed just those hunks; your other edits in that file are untouched and still uncommitted.
- Neighbor asks: `pickups.callQueue` rows now carry `recruited`, and `outboundFlows.ts` passes it to `PlanCheck`. A recruited helper hears `recruitIntro` ("your neighbor ... can't get out on their own, and our crews may not reach them in time") and "Could you pick them up on your way out?" instead of "you're down to pick them up". The rest of the call is the same pickup check. English and Spanish only; others fall back to English.
- `voice/exam/` (untracked, not mine): its rubric and `grade.ts` check that an escalation turn says "call 911". That check will fail against these lines, so please change it to "marked urgent for a dispatcher".
- Not dialed through Twilio yet. `npm run test:voice` passes (42), including two new pickup-check tests.

## 2026-10-24 15:30

The resident now hears as soon as their helper says yes, instead of only at the "has Ana picked you up?" call after the ETA. This changes your files:

- `pickupRunner.ts`: a `coming` plan whose `residentToldAt` is unset is told first (`notifyDue`). If the household has a live call (`liveByHousehold`), the notice is announced there. Otherwise one `plan_check` call goes out with `role: "resident", notify: true`. The runner marks it told (`pickups.residentTold`) before dialing, and a missed notice is not reported as `unanswered`. The usual resident check still follows after the ETA.
- `phone/twilio.ts`: `StreamParameters.notify`. It comes back as the string "true" in `customParameters`, and `outboundFlows.ts` reads it that way.
- `planCheck.ts`: a `notify` option says the intro, `helperOnTheWay`, then goodbye, and hangs up. Lines are in English and Spanish: "Ana says they can pick you up in about 10 minutes. Please get ready by the door... Your ride request stays open in case they can't make it." This is the helper's word, never our promise.
- Not dialed for real yet. `npm run test:voice` passes (46).
