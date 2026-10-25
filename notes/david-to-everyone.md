# Notes from David to everyone

## 2026-10-24 20:20

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

## 2026-10-24 20:35

- **`issueWarning` puts every `complete` home back in the warning-call queue** (`callStatus: "not_called"`, `attempts: 0`). A home that phoned in before the warning went out used to count as already called, so it never got the warning call and its neighbor pairing never started. Its record stays as that call left it.
- **The `warning` checkpoint is now taken fresh at every warning.** It used to be taken once per run. Now a profile fixed between a rewind and the next warning is what the next rewind to the warning restores.

## 2026-10-24 21:00

- **The dispatcher drives in the traffic forecast.** Its drive times now include the Langevin crowd model's forecast, and `robust-penguin-834` already runs it. That covers the solver, revocations, the ETA a rider hears in a callback, and the simulated vans' movement. Each street is slowed by its forecast slowdown in the direction the van drives it (`convex/traffic.ts`; the forecast runner writes the small `meshDriveTimes` table). With no fresh forecast, every street drives at free flow, as before.
- **The forecast runner is safe to run again** (`npm run forecast:traffic`), now that the deployed backend takes its new fields. This replaces the "don't run it until you deploy" line in `notes/MtoC.md`. With it running, outbound trips with the evacuation take a median 1.3 to 1.4 times longer in the full-population runs, and trips into the zone barely change. `docs/mesh.md` has the numbers.

## 2026-10-24 21:05

**One call per person for a pickup.** The warning call now carries the pickup question instead of a second call after it.
- **The helper:** when their warning call reaches its goodbye and a pickup question is due for them, the question replaces the goodbye ("Before you go: your neighbor Jerry at ... can't get out on their own ..."). The same goes for an update owed to them.
- **The resident:** someone on hold for a driver gets their helper's answer and the confirmation question on the same line ("While you're on the line, I have news about a pickup ...").
- **Where:** `voice/phone/callSession.ts` subscribes to `pickups:callQueue`. `voice/pickupRunner.ts` `dueOnThisLine` picks the question, `pickupFlowFor` in `outboundFlows.ts` builds it, and `PlanCheckOptions.continued` swaps the greeting for a continuation line (en, es). The line keeps its call-floor row and transcript. The pickup mutations take the answers, and a hang-up mid-question counts as unanswered, as on its own call.
- **To whoever is reworking `conversation.ts` and the lines (sponsor lead):** the hand-over spots the end of the warning call by `turn.done` and drops the closing `LINES[language].goodbye` sentence. Please keep the goodbye a fixed line, or tell me and I'll key it on something else.

**Contract:**
- `pickups:callQueue` rows gain `helperAwaitingCall` and `residentAwaitingCall`: true while that person's own warning call hasn't been tried yet tonight (in the zone, `not_called`, no attempts). The pickup runner holds a separate pickup call while that's true, so the warning call asks it.
- `nextToCall` now skips a helper only while a pickup call is ringing them or they're already on the way, no longer from the moment they're asked. Before, a paired helper never got their own warning call.
- Neighbors paired at the Ready check are now asked at the warning, on the strength of the Ready check, not after the resident's call says they can't leave. The resident still confirms before the ride counts, and the van request stays open.
