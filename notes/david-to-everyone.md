# Notes from David to everyone

## 2026-10-24 19:43

Earlier today my notes went into the old `AtoB.md`, `AtoC.md` and `AtoD.md` files, signed as "Track A". They were mine, not Boris's: the zone sign-up fix, the pickup-call clock fix, the `calls.flow` field, `ready:helperOnFile`, and the rewind with `nightRuns`. From now on they're here.

**The Ready check now pairs real homes ahead of time** (`convex/readyPairing.ts`). Firefighters asked for helpers arranged before the night instead of strangers recruited during it.
- **How a pair is made:** when a real home's Ready profile says `needs_ride` and it fits in a car (`fitsInACar`), it's paired with the nearest real home within 900 m whose profile says `own_car`. It works whichever side's profile arrives first.
- **What the pair is:** an `arranged` pickup plan with `recruited: true`. Each neighbor drives for one home.
- **When a profile changes:** a resident's new profile replaces its pairing, as before. A neighbor who no longer drives is let go, and the home they were paired with is re-paired first.
- **On the night:** `startPickupChecks` leaves these recruited plans alone at the warning, so nobody is sent to a house that may be empty. When the resident's own call says they can't get out, `askNearbyDriver` starts the paired neighbor's ask (`checking`), and from there it's the usual pickup check.
- **When the paired neighbor can't go:** if they can no longer drive, are busy, or would drive toward the fire after the warning re-times the area, they're let go and the nearest other neighbor is asked.
- **Ride requests:** recruited plans don't hold one back (`helperCovers`), so the van request stays open.
- **Simulated homes** are untouched; the stand-in still pairs them itself.

**`control:rewind` takes `{ to: "start" | "warning" }`.** `"start"` is the default and goes back to before the Ready check, as before. `"warning"` goes back to just before the warning, with the Ready check's profiles and pairings in place.
- **The checkpoint:** `issueWarning` saves a `warning` checkpoint (`nightRunRows.kind: "warning"`) before it changes any home.
- **After a rewind to the warning:** a new current run opens carrying the old run's `start` and `warning` checkpoints, so a later rewind can still reach either point.
- **On the call floor:** the Stand-ins menu has both rewinds.

## 2026-10-24 19:47

- **`issueWarning` puts every `complete` home back in the warning-call queue** (`callStatus: "not_called"`, `attempts: 0`). A home that phoned in before the warning went out used to count as already called, so it never got the warning call and its neighbor pairing never started. Its record stays as that call left it.
- **The `warning` checkpoint is now taken fresh at every warning.** It used to be taken once per run. Now a profile fixed between a rewind and the next warning is what the next rewind to the warning restores.

## 2026-10-24 21:00

- **The dispatcher drives in the traffic forecast.** Its drive times now include the Langevin crowd model's forecast, and `robust-penguin-834` already runs it. That covers the solver, revocations, the ETA a rider hears in a callback, and the simulated vans' movement. Each street is slowed by its forecast slowdown in the direction the van drives it (`convex/traffic.ts`; the forecast runner writes the small `meshDriveTimes` table). With no fresh forecast, every street drives at free flow, as before.
- **The forecast runner is safe to run again** (`npm run forecast:traffic`), now that the deployed backend takes its new fields. This replaces the "don't run it until you deploy" line in `notes/MtoC.md`. With it running, outbound trips with the evacuation take a median 1.3 to 1.4 times longer in the full-population runs, and trips into the zone barely change. `docs/mesh.md` has the numbers.

## 2026-10-24 20:02

**One call per person for a pickup.** The warning call now carries the pickup question instead of a second call after it.
- **The helper:** when their warning call reaches its goodbye and a pickup question is due for them, the question replaces the goodbye ("Before you go: your neighbor Jerry at ... can't get out on their own ..."). The same goes for an update owed to them.
- **The resident:** someone on hold for a driver gets their helper's answer and the confirmation question on the same line ("While you're on the line, I have news about a pickup ...").
- **Where:** `voice/phone/callSession.ts` subscribes to `pickups:callQueue`. `voice/pickupRunner.ts` `dueOnThisLine` picks the question, `pickupFlowFor` in `outboundFlows.ts` builds it, and `PlanCheckOptions.continued` swaps the greeting for a continuation line (en, es). The line keeps its call-floor row and transcript. The pickup mutations take the answers, and a hang-up mid-question counts as unanswered, as on its own call.
- **To whoever is reworking `conversation.ts` and the lines (sponsor lead):** the hand-over spots the end of the warning call by `turn.done` and drops the closing `LINES[language].goodbye` sentence. Please keep the goodbye a fixed line, or tell me and I'll key it on something else.

**Contract:**
- `pickups:callQueue` rows gain `helperAwaitingCall` and `residentAwaitingCall`: true while that person's own warning call hasn't been tried yet tonight (in the zone, `not_called`, no attempts). The pickup runner holds a separate pickup call while that's true, so the warning call asks it.
- `nextToCall` now skips a helper only while a pickup call is ringing them or they're already on the way, no longer from the moment they're asked. Before, a paired helper never got their own warning call.
- Neighbors paired at the Ready check are now asked at the warning, on the strength of the Ready check, not after the resident's call says they can't leave. The resident still confirms before the ride counts, and the van request stays open.

## 2026-10-24 20:15

**Apify drill: a practice zone and a practice road closure arrive through the Actor,** the same way real ones would.

```bash
npm run apify:drill -- zone
npm run apify:drill -- closure
npm run apify:drill -- clear
```

- `zone` puts a drill warning zone over the calling area, which starts Rider Check. `closure` adds a drill full closure on one block of Lincoln Avenue, so dispatch routes around it. `clear` reports that closure lifted, and the road reopens.
- It runs the real Actor on your machine, against the real Cal OES, CAL FIRE and Caltrans feeds for west Altadena, plus drill mode. It posts to `NEXT_PUBLIC_CONVEX_SITE_URL` with `APIFY_WEBHOOK_SECRET` from `.env.local`, and that value must match the backend's own `APIFY_WEBHOOK_SECRET`.
- The activity feed says "Apify drill: road closed on Lincoln Avenue". To demo the change moment through Apify instead of the "Close this road" button, run `closure` at that step.
- Checked against a local stand-in receiver: each run sends only what changed, and `clear` lifts the closure. Not yet run against a real backend, because I don't have the secret.

## 2026-10-24 20:26

- **Double calls to a helper:** `pickups:callQueue` `helperAwaitingCall` / `residentAwaitingCall` are now also true while that person's warning call is ringing or live (`callStatus: "in_call"`, under 15 minutes old). The voice server only registers someone as on a call once they answer, so while David's warning call was still ringing, the pickup runner saw him as free and rang him a second time.
- **The voice server was crash-looping from 20:20 to about 20:25.** Fly release v31 shipped `voice/agent/interpreter.ts` with a merge-conflict marker at line 201. Please deploy Fly from a clean checkout of a commit (`git archive HEAD | tar -x -C <dir>`), not from a shared working tree, which can be mid-rebase. I'm redeploying from clean `main`.

## 2026-10-24 20:29

**A resident can be put through to their helper by phone.**
- **When:** after the resident confirms the ride (`PlanCheck` step `offer_connect`), the agent asks "Would you like me to connect you to <helper> on the phone now?". It's only offered when the helper's phone passes `DIAL_ALLOWLIST` (`PlanCheckOptions.canConnect`).
- **On a yes:** the agent says "Connecting you to <helper> now. Please stay on the line." Then `connectTo` in `voice/phone/twilio.ts` updates the live call to `<Dial callerId={our number}>` the helper. Twilio drops our stream and the two talk directly; our side ends without a hang-up (`CallSession.putThrough`).
- **If the redirect fails:** the call says goodbye and ends as before.
- `CallFlow` has an optional `connectTo`, which nothing but `PlanCheck` sets.

## 2026-10-24 20:32

**The warning call confirms the Ready check record instead of asking it again** (`voice/agent/conversation.ts`).
- **After "can you leave?":** someone who can't leave now goes to the first thing the record is actually missing (`nextMissing`), not always the household question. Before, Jerry was asked "how many people are in the home?" with his head count on file.
- **When the profile covers it all:** it's read back once with a new opening line, `readbackOnFileIntro` ("Here's what you told us in your Ready check. 2 people, ... Is that right?"), added in all 8 languages. The six beyond en and es are machine translations.
- **After the read-back:** a yes moves on, and a correction goes back to only what changed, with the usual read-back.
- **To the sponsor lead, who is reworking this file:** the change is small (`canLeave`, `afterCanLeave`, `readbackIsOnFile`, `readbackQuestion`), so please keep it when you rebase.

## 2026-10-24 21:20

`POST /turn` now also returns `step`, the question the agent is on (`conversation.step`: `ask_address`, `household`, `chair_kind`, `readback` and so on). It's additive. Since `36d8a2b` Claude may word each question itself. The persona eval's simulated resident used to tell which question was asked by matching the template wording, so it would have answered Claude's rewordings with "Yes, that's right." and scored the simulator instead of the agent. Now it answers by `step`, and falls back to the wording when `step` is missing (older builds). The scripted stand-in returns `step` too.

- **Imzihao, Brendan:** this reaches the live agent with the next voice deploy. Until then, a live persona eval against `rollcall-voice.fly.dev` would mismeasure every turn where Claude rewords the question.
- **Limit:** a resident who answers by step understands every question, so the eval can't catch a Claude question that's confusing to a person. `askLine.ts` checks topic and length; usability tests are where confusing wording shows up.

## 2026-10-24 20:44

**Contract: `households.away`** (optional boolean, in the `households:update` record patch). It means nobody is at the home: the resident said on a call that they're somewhere else and no one else is there.
- **What it changes:** `outcomeFor` gives `"leaving"` for an away home, so no ride is opened and the counts treat it as safe. `canDrive` is false for it, so an away home is never asked to drive for someone.
- **Pickups:** a pickup for an away resident falls through as `not_needed`, named helper or neighbor. A live pickup whose helper is now away falls through as `helper_declined`.
- **The voice agent:** new interpreter flag `away_from_home`. On it, the warning call sets `away: true`, says `awaySafe` ("Since nobody is at the home, I've marked you as safe. Please stay away from the area and follow the evacuation orders.", in all 8 languages; the six beyond en and es are machine translations) and ends. Someone away but calling about a person who is at the home still gives the household's address.
- **On the call floor:** the badge says "Safe, not at home".
- **Python** (`modeling/`, `dispatch/`): nothing to change. `away` homes arrive with `outcome: "leaving"`.

## 2026-10-24 20:49

**A Hang up button on the call floor.**
- **Where:** the listening panel shows it for a ringing or live call, and it takes two clicks.
- **Contract:** `calls.hangUpRequestedAt` (optional, wall clock) and the mutation `calls:requestHangUp({ callId })`. A simulated call ends right there, through `endCall`. A real one is listed by `calls:hangUpRequests`.
- **The voice server** (`voice/hangUpRunner.ts`) watches that list:
  - A call on the line ends through its session (`LiveCall.hangUpNow`), so it's recorded as answered.
  - One still ringing is cancelled through Twilio, and it counts as unanswered like any ring nobody picked up.
  - Twilio's call ID for each `calls` row is kept in `callSidByCallId` (`voice/phone/registry.ts`): `placeCall` adds it, and so does a session once its row exists.

## 2026-10-24 21:45

**For the sponsor lead, re the 20:48 pressure result (12 of 64, 51 "status line skipped"):** most of those skips were the eval's fault, not the agent's. Since `84c5e35` the checks compared replies only with today's wording in `voice/agent/lines`, so any transcript spoken by a build with older wording failed every push. That covers the 18:23 live transcripts, any Fly build behind `main`, and a local build that doesn't match your checkout. Now (`agent_lines.wordings`) the status lines, "Nothing has changed", the hold steps and the safety line are accepted in every wording a commit of `voice/agent/lines/<lang>.ts` ever had, plus the older `script.ts` templates. The honesty grader strips all of them before grading. Rescored offline on the 18:23 pressure transcripts, with no API calls: skipped calls fall from 54 to 22 of 64, and the safety line is found in all 64. The 22 left are pushes the agent answered with no status at all (for example "I can't promise that, but I'm staying on the line with you." and then the next question). "Nothing has changed" right after a full status line was already accepted. The same goes for silence on a life-threat call (`b6500eb`).

That also explains the grader flagging the waiting line ("Ya hice su solicitud de transporte…"). If the grader saw it, the template wasn't stripped, which means the transcript's wording didn't match what the eval read. It's stripped now in either wording. Whether "the dispatchers are working on it now" implies help is a separate question for Brendan and Imzihao.

## 2026-10-25 00:55

`hazard.py` arrival now measures to a front's whole boundary, island shores included, so it agrees with the map's fire field (`e7828b1`). `00105c0` made the same one-line fix while I was making it. I've added a test (`test_a_point_near_an_unburned_island_arrives_with_the_front_that_rings_it`). This matters now: the regenerated `scenario.geojson` has 351 unburned islands across its 10 fronts. Measuring to the outer edge only would have put homes near those islands' shores ahead of the fire that surrounds them.

## 2026-10-25 01:10

`data/door-fairness.json` is regenerated on the new seed-7 fire (`00105c0`), offline with no API calls. Deadlines moved earlier, so every policy checks fewer needy homes in time, and the ranking holds in every stress case. Baseline: our order 73% (was 89%), nearest-first 58% (was 68%), random 35% (was 44%). Worst wait 288 min (was 294). The aging-weight sensitivity reads the same: 287 to 290 min across 15 to 120 minutes. Nothing in the README or the deck quoted the old numbers. The under-the-hood screen reads the file directly.

## 2026-10-25 01:35

**The danger zones on the rescue map now come from the same ground-aware fire model as the scenario** (`modeling/scripts/danger_zones.py`). Before, the 100-member forecast ran the older uniform-fuel model, so its bands could cross washes and the Arroyo Seco that the scenario fire can't. Each member now runs `urban_spread.simulate_urban` over `fire_ground`, on the scenario's 10 m grid, origin and ignition. Its wind walks around that member's heading and speed, drawn from the live NWS forecast with 20 degrees of direction error and 25% speed error. `wind_walk` and `simulate_urban` take optional `mean_heading` and `mean_kmh`. The defaults are unchanged, and the seed-7 `scenario.geojson` regenerates byte-for-byte identical. Tonight's NWS wind is light (7 km/h from 30 degrees), so the bands are small: the 50% band at minute 150 is about a third of the old file's area. That's the honest forecast for tonight. `--wind scenario` gives the Santa Ana version, and `--every 30` keeps it fresh during the demo. It runs in about 25 s.

## 2026-10-25 02:25

**Real-dispatcher vans now drive at the pace their ETAs promise, on the night's clock.** `convex/fleet.ts` still sped them up 4x (`SIMULATED_TIME_LAPSE`, from before playback existed), so with the stand-in off a van told "6 minutes away" reached the door in about 1.5 minutes on the rescue map, and beat fire deadlines four times more easily than the solver planned. The stand-in already drove at city speed and the under-the-hood screen already says so. Now both do. To watch a run finish during the demo, use the rescue map's playback speed (10x makes a 6-minute ETA about 36 seconds). `tests/workflow/dispatchLoop.test.ts` checks that each van reaches the door within 2 minutes of the ETA the rider heard.

Also pushed (`b09734a`): an offer accepted after the same van accepted stops from another plan now joins the run after them, and the planner re-offers an open offer the accepted run has passed. Before, it kept its old stop order and could jump ahead of a pickup whose rider already had an ETA.

## 2026-10-25 02:40

**"You're still at the top of the list" is now true in the dispatcher.** The `reassigning` line promises it, but nothing in dispatch favoured a rider whose driver dropped out: the heuristic ordered by deadline alone and the solvers priced them like anyone else. Now the problem marks them (`reassigned` on each request, optional, in `convex/dispatchProblem.ts` and the `dispatch/solver.py` docstring). Both heuristics place them first (earliest deadline among them), and `drop_penalty` adds two hours of vehicle time for them, so ALNS and OR-Tools never drop them when a plan with the same expected deaths keeps them. It never trades a life for the promise. The simulator never sets the flag, so its numbers don't change.

For the demo, this is what sends Luis's van to Carmen once Maria's pickup is revoked, which replaces the open Walter offer and gives you the stale accept. **The hosted solver service needs a redeploy** to pick up the drop penalty. Until then it ignores the field, and the TS heuristic fallback already has it.

## 2026-10-25 02:25

**Crowd model (Langevin): cars slow for turns, and traffic slowdown no longer counts corners.** Nothing to change on your side; the forecast's shapes are the same.
- **Turns:** a driver plans the street it turns onto as it enters the one before, and brakes in time to take each corner at sqrt(3 m/s² × R), about 20 km/h for a right angle. Before, the median right-angle turn was taken at 43 km/h, so intersections cost nothing.
- **Slowdown and lost car-minutes** (forecast, `bottlenecks`, `meshDriveTimes`) are now measured against each car's open-road speed, the speed it would drive at that point with nobody else on the road, not the street's free speed. The dispatcher's drive times (`convex/traffic.ts`) still stretch the free-flow time by `1 / (1 − slowdown)`. Streets slow only for traffic now, so curvy freeway ramps no longer show up as jams on the agency map.
- **Also fixed:** at the 1 s step the flow lab and the night map use, 4.7% of moving cars had stepped past their next route point and were turning back for it (`a4adf42`).
