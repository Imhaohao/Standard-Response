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


## 2026-10-24 15:25

The 6pm gate is gone from PLAN.md, at the team's request. Nothing is held back until a checkpoint any more: each track finishes its whole list, add-ons included, and the add-ons lose their one-hour timebox. Each track section now has one list in place of "Before the gate" and "After the gate". Please also run the full Rider Check flow end to end as soon as real calls work, and again after every big change.

## 2026-10-24 15:30

- `pickupRunner.ts`: a helper call waits while the helper's household is on another live call (`liveByHousehold`), since it would come up busy. `callQueue` rows carry `helperHouseholdId` for this.
- The dialer's queue (`households.queue` / `nextToCall`) no longer returns a household that is being asked to drive or is already on the way.
- The recruited question is now "Could you pick them up and drive them out?", because the neighbor may live just outside the zone.
- Interpreter, checked live on Haiku: "No, I need help ASAP" in answer to `askCanLeave` gives `canLeave=no`. The same words during the greeting give no update, so the neighbor is called one question later. If you want the greeting to catch it, that change belongs in your `interpreter.ts`.


## 2026-10-24 16:30

Dispatcher login (Auth0) is in, switched off until `AUTH0_DOMAIN` is set, so nothing changes for you today. Run `npm install` after you pull: it adds `@auth0/nextjs-auth0`. There is now a root `proxy.ts`, which is Next 16's name for middleware. While Auth0 is off it passes every request straight through, and it never touches `/api/*`. When it is on, the call floor, rescue map, under-the-hood, simulated phone and driver page need a login with a role. Public pages stay open: `/ready`, `/prepare`, `/mesh`, `/flow`. The README section "Dispatcher login (Auth0)" has the setup.

## 2026-10-24 15:42

The night now runs on a shared clock that the rescue map can pause or play at 1×, 10×, 30× or 60× (`control.clock`, `lib/sim-clock.ts`, `control:setPlayback`). Until someone presses a control, it reads the same as the wall clock, so nothing changes for you.

- **In Convex**, use `await simNow(ctx)` from `convex/clock.ts` for every time you store or compare: `at`, `createdAt`, deadlines, ring and retry waits. I switched every existing `Date.now()` in `convex/` to it. The exceptions are solve timings, the mesh and survey add-ons, and the re-plan cadence and lock in `dispatch.ts`, which stay on the wall clock so faster playback never calls the solver more often.
- **In the browser**, use `useSimNow()` from `lib/use-sim-now.ts` wherever you compare against a stored time. `useFireClock` already reads it.
- **Faster playback** moves the clock further on each 900 ms tick. It doesn't tick more often. `fleet:tick` receives `tickMs` scaled by the speed, and the dispatch snapshot carries `now` on the night's clock. While paused, the loop stops scheduling ticks, so a paused night costs nothing.
- **Real phone calls** still run at real speed, so a run with live calls is best left at 1×.
- **Stand-in vans** now drive at the 7 m/s their ETAs assume, not 60 m/s. Use 10× or more to make them visibly move.

## 2026-10-24 16:35

Changes from our two Palo Alto Fire station visits, in your voice code. `npm run test:voice` passes (102) and nothing in the contract changed.

- **New step `chair_kind`** in `conversation.ts` and `readyCall.ts`. When someone says "wheelchair" without saying which kind, the agent asks `askChairKind` ("Is it a power wheelchair, the kind with a motor?"). A yes sets `power_wheelchair`, and a no keeps `manual_wheelchair`. After two unclear answers it moves on and keeps the chair manual. A manual chair already on file isn't asked about again. A firefighter at Station 1 said: "you said wheelchair, I thought wheelchair. And then you get there, and it's a battery-operated wheelchair, and they're 400 pounds." Since `fitsInACar` sends neighbors to manual chairs, the default mattered.
- **Interpreter**: a new flag, `says_chair_kind` (`Interpretation.saysChairKind`, optional), is set when they name the kind themselves, so "my wife pushes my chair" isn't asked again. `quickAnswer.ts` reads a bare yes or no at `chair_kind`.
- **Lines**: `askChairKind` and `askAgain.chairKind` are in all eight languages. The zh, ko, vi, tl, ru and ja versions are machine translations, like the rest of those files. `mobility.manual_wheelchair` now reads "someone uses a manual wheelchair", so the read-back says the kind out loud.
- **Pickup check** (`planCheck.ts`): before asking, the helper now hears what the pickup takes: "They use a walker. They need one person to help them to the car. They use oxygen." That's `PlanCheckOptions.needs`, filled in `outboundFlows.ts` from new `pickups:callQueue` fields (`mobility`, `assistanceRequired`, `oxygen`). English and Spanish only, like the rest of the plan-check lines. Station 1 asked for exactly this: neighbors should know "what they're getting into right away."
- Worth a re-run of `npm run exam:voice` when you next certify. I didn't run it because it costs API calls.

## 2026-10-24 16:40

- `planCheck.ts`: when a helper says yes, they hear the resident's number ("Wen's number is 6 5 0, 6 5 6, ..."), and the resident's "on the way" notice gives the helper's number. Both come from `callQueue` (`residentPhone`, `helperPhone`), spoken with `readyCall`'s `spokenDigits`. These only take effect on calls once Fly is redeployed.

## 2026-10-24 18:42

`households.inZone` for homes added after a zone is drawn: `ready:submit` (and `ready:reregister`) and `riders:importCsv` now mark a new home in the zone when it falls inside the zone drawn last. With no zone drawn, a home that signs up after the warning is out counts as covered, the same as `coverAreaIfNoZone` gave the homes already on file. Until now every new home started with `inZone: false`, so a home that signed up inside a zone that was already drawn was never called, and no neighbor was asked for it, until somebody redrew the zone. A sign-up that moves an existing home to a new address also gets its `inZone` recomputed. The helper is `warningCovers` in `convex/riders.ts`. Nothing in the contract changed.

## 2026-10-24 19:05

Small prompt change in your `voice/agent/interpreter.ts` (and the matching line in `readyInterpreter.ts`). On tonight's live run, "they need a person to reel them out of the building" came back as `two_person_lift`. That took the home off a neighbor's car (`fitsInACar`), so no neighbor was asked and the pickup calls never started. The prompt only had examples for two people. It now also says that one person pushing a chair or helping them to the car is `one_person_assist`, and that it's `two_person_lift` only when they say two people or that the person must be lifted or carried. I checked three sentences against the live model: Jerry's sentence and "my daughter has to push my wheelchair out to the car" now read `one_person_assist`, and "it takes two of us to lift him out of bed" still reads `two_person_lift`. `npm run test:voice` passes (185). Worth a re-run of `npm run exam:voice` when you next certify.

## 2026-10-24 19:00

The Ready call now confirms a helper who's already on file instead of asking from scratch. Tonight Jerry's form named David as his helper. His Ready call then saved a profile with no confirmed helper, `arrangePickup` replaced the arrangement, and the warning had nobody to call.

- New query `ready:helperOnFile({ householdId })` (Track A) returns `{ name, phone, relation? }` from the home's `arranged` pickup plan, or `null`. It returns nothing once the night's check has started.
- `outboundFlows.ts` `readyCallFor` passes it as `ReadyCallOptions.helperOnFile`.
- `readyCall.ts`: when the resident's exit plan is `helper` and they give no number, and they name nobody or the same first name, the call reads the helper back with the new line `confirmHelperOnFile` ("We have David at 4 2 5, ... down to pick you up. Is that still right?"). It's in English and Spanish, like the rest of the Ready lines. A "no" asks for the number again, the same as `rejectPhone`. A new name asks for that person's number, and `needs_ride` or `own_car` still drops the helper.
- Tests are in `planCheck.test.ts` ("with a helper already on file") and `tests/workflow/realPickupFlow.test.ts`. `npm run test:voice` passes (191).
- I'm deploying Convex and then Fly from a clean copy of `main`.

## 2026-10-24 19:25

Two night-clock bugs in the pickup calls, both in your voice code:

- `outboundFlows.ts` worked out the helper's ETA with `minutesUntil(plan.helperEtaAt)` against `Date.now()`. `helperEtaAt` is on the night's clock, which tonight ran about 13 hours ahead of the wall clock, so Jerry heard that David would arrive in about 800 minutes. The ETA now uses `simTime(control.clock, Date.now())`, and `minutesUntil` takes `now` with no default.
- `pickupRunner.ts` `tick` compared `lastAttemptAt` and `helperEtaAt` (both night-clock) with `Date.now()`. A missed pickup call was never retried, and the "were you picked up?" call never came due. `now` is now the night's time from the `control.clock` it already subscribes to.
- `voice/Dockerfile` copies `lib/sim-clock.ts`, the one helper both use.
- `npm run test:voice` passes (191).

## 2026-10-24 19:35

Contract: `calls` has a new optional field `flow`, which only adds fields. Your table, so please tell me if you'd rather it went another way. Until now, pickup-check and Ready-check calls had no `calls` row, so the call floor never showed them; tonight David's pickup call rang with nothing on screen.

- `flow` is `{ kind: "pickup", planId, role, purpose }` or `{ kind: "ready" }` (validators `callFlow`, `pickupRole`, `pickupPurpose` in `schema.ts`). `householdId` is the home the call is about; for a pickup that's the home being picked up, even on the helper's call.
- New mutation `calls:startFlow({ householdId, flow })` opens the row as `live`. `callSession.beginOutboundFlow` calls it with what `outboundFlowFor` now returns (`{ conversation, call }`), then logs lines and stages through `calls.say` / `calls.setStage` like any call. A failure to open the row is logged and doesn't stop the call.
- `endCall` returns early for a `flow` call after setting its phase. The home's `callStatus`, attempts and reach ladder stay as they were, and the pickup and Ready results still go through their own mutations.
- The call floor labels these rows "Asking helper", "Confirming ride", "Picked up?", "Update to helper/resident" or "Ready check" in place of the stage. `calls:detail` returns `speakerName`, which is the helper's name on a helper's call.
- `calls:active` now lists these calls too. That means `sim.ts`'s concurrency count and `deploy-guard.ts` see them as well, which is what we want there.

## 2026-10-24 19:55

Every night is now kept, and there's a rewind (`convex/nightRuns.ts`). The contract only gains things: two new tables and one optional `control` field.

- **`control:rewind`** goes back to before the Ready check on the same homes. It saves the night, clears the night's tables, and puts every home and arranged pickup back as they were when the run started. Zones and personas stay. Stand-in switches are kept.
- **`control:reset`** still clears everything, homes included, but saves the night first. It also refuses while a real call is live, the same as the rewind.
- **Where it's kept:** `nightRuns` holds one row per night (`startedAt`/`endedAt` on the wall clock, `warningIssuedAt`, `hazard`, `endedBy`, `savedRows`). `nightRunRows` holds the saved documents: `start` rows are the homes and pickups when the run began, `end` rows are everything the night left. Read them with `nightRuns:list` and `nightRuns:rows({ runId, table, kind, paginationOpts })`.
- **When a run starts:** `ready:start` or `control:issueWarning`, whichever comes first after the last rewind. Both refuse while `control.archivingRunId` is set, which is while the copy runs, in batches.
- **Tables a rewind clears:** transcriptLines, texts, calls, events, callbacks, auditLog, assignments, plans, requests, nominations, roadClosures, neighborCalls, pickupPlans, vehicles, shelters, vehicleRoutes, vehicleLoads, dispatchState. That's what reset already cleared, less the setup. `callPlans`, the mesh tables and the prepare tables are untouched, as before.
- **Readers keyed to a night:** nothing to change. After a rewind, `warningIssuedAt` is unset and the next warning gets a new one.

## 2026-10-24 21:10

The activity list now opens calls, including ended ones. Two small additions, both optional fields only:

- `events` has a new optional `callId`. An event that names a call opens that call's transcript; older events without it are matched to the latest call at their home.
- `endCall` writes one `call` event, with `callId`, when a pickup or Ready call (`flow` set) ends: "Ready check call with <address> ended" or "Ready check: no answer at <address>". Those calls wrote nothing to the activity list before, so a finished one couldn't be found again. Warning calls are unchanged: their record and retry events already point at them.

## 2026-10-24 21:40

Ready check calls on simulated homes are now calls on the floor, so they can be watched live. Nothing changes for your real Ready calls.

- The Ready stand-in (`ready.ts`) opens a `calls` row with `flow: { kind: "ready" }` and `simulated: true` for each home. It rings, says its script a couple of lines per tick (`readyScript` in `readySim.ts`), fills the record as answers come in, saves the profile, and ends through `endCall`. It keeps up to `maxConcurrentCalls` on the line.
- `calls.ts`: the body of `startFlow` is now `startFlowCall(ctx, household, flow, { simulated, phase })`, which the stand-in shares. `startFlow` behaves exactly as before.
- `sim.ts`: `standInVoiceAgent` skips calls with `flow` set. Before, it would have run the warning script on them.
- `scripts.ts`: exports `needsLineFor(language, truth)`, the resident's mobility answer, which the Ready script reuses. `scriptFor` is unchanged.
- Pausing the Ready check or issuing the warning hangs up any stand-in Ready call still on the line.

## 2026-10-24 21:50

`endCall` also writes the `call` event (with `callId`) when a real, non-simulated warning call is answered: "Warning call with <address> ended". A real call that didn't change the home's outcome left no activity row before, so it couldn't be opened afterwards. Simulated warning calls are unchanged.

## 2026-10-24 19:55

From now on my notes go in `notes/boris-to-everyone.md` and `notes/boris-to-<name>.md`. Please write yours as `notes/<you>-to-boris.md`. See `AGENTS.md`.
