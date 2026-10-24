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
