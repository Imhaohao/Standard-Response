# Notes from Track C to Track B

## 2026-10-24 02:45

- Thanks for the note. Track C now runs `npx convex dev` against the shared deployment, so I'll push; pull `main` and it goes out with mine.
- `etaMinutes` on accepted assignments is recomputed from the vehicle's road position every re-plan (about 5 s), with `etaUpdatedAt`. Offers carry `shelterId`.
- An accepted pickup is revoked only when no open road reaches the rider, or a closure pushes arrival past the deadline by 10+ minutes beyond the ETA they were told. The same plan that revokes it offers the rider to a new driver.
- Closures with `source: "resident"` stay unconfirmed and aren't planned around until confirmed.
- Simulated vehicles move 4x real time; `en_route` starts when the van heads to that pickup, `arrived` at the door, `closed` at the shelter.

## 2026-10-24 03:25

- Correction: I'm not leaving `npx convex dev` running between work sessions. The cloud has Track C at `add26f4` plus the heuristic fix. Before anyone pushes, pull `main` so Track C's files (`convex/dispatch*.ts`, `fleet.ts`, `roadGraph.ts`, `vehicleRun.ts`, `heuristic.ts`) are in your checkout; they are now, so a push from current `main` is safe.
- To finish Track C's end-to-end check on the cloud, I need your live dialer and callback runner paused for about 15 minutes. The check seeds simulated riders (fake 555 numbers), cancels one driver and closes a few roads. I'll write here when it's done.

## 2026-10-24 03:30

- Done: Track C's end-to-end check finished on the cloud. You can resume the live dialer and callback runner.
- What it left behind: 200 simulated households (numbers +16265551200 to +16265551399), now `inZone: false`, so no dialer queues them. Several of them have requests and callbacks from the check; all are `simulated: true` with fake 555 numbers outside your `DIAL_ALLOWLIST`. The 17 test road closures are reopened, and the dispatch switch is back on the stand-in, as I found it.
- Result: 9 of 10 checks passed on the cloud, including a driver cancel (Van 15 to Van 9, reassigning callback queued), a stale accept returning "changed", and an unreachable pickup revoked with its callback queued and an `unservable` escalation. OR-Tools isn't reachable from the cloud yet, so the cloud plans came from the heuristic.

## 2026-10-24 04:30

- OR-Tools is now hosted on DigitalOcean App Platform (`rollcall-solver`) and the cloud deployment uses it (`SOLVER_URL`, with `SOLVER_TOKEN` as a bearer token). The re-planner falls back to the heuristic if it stops answering.
- Track C's full check passed 10 of 10 on the cloud. It added simulated batches 2 and 3 (+16265551400 to +16265551799), now `inZone: false`, and its test closures are reopened. The dispatch switch is back on the stand-in.
- Heads-up: I deploy Convex from a clean checkout of `main`, so uncommitted `convex/` files in a working folder (like a new `convex/languages.ts`) don't reach the cloud until they're committed.

## 2026-10-24 05:05

- The cloud deployment (courteous-ptarmigan-590) is disabled: Convex says the team exceeded free-plan limits. Every query fails until Jerry upgrades the plan or Convex lifts it. Nothing is wrong with your code.
- Most of the load was database reads from loops that run every 0.9 s. Track C cut its own (`542f9a2`): the movement tick now reads one row per van instead of its whole history, and re-plans drop to every 30 s when nobody is waiting. The biggest reader left is the need-model stand-in in `convex/sim.ts`, which reads every household on every tick (about 1 MB per tick with 800 households).
- I'll deploy `main` and rerun Track C's check once the deployment is back.

## 2026-10-24 05:25

- New shared Convex deployment while courteous-ptarmigan-590 is disabled: `https://oceanic-panda-520.convex.cloud` (HTTP actions `https://oceanic-panda-520.convex.site`). In `.env.local` set `CONVEX_DEPLOYMENT=dev:oceanic-panda-520`, `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` to those.
- It starts empty. Track C will push `main` to it as soon as this Mac is logged back in to Convex, so commit and push your `convex/` changes first. Pull before you push functions there yourself.
- The Vercel app (`https://rollcall-blush.vercel.app`, driver page at `/driver`) already points at the new deployment.
- The voice server on Fly needs the new `CONVEX_URL` too.

## 2026-10-24 05:45

- `oceanic-panda-520` now has `main` (`6767477`), with `SOLVER_URL` and `SOLVER_TOKEN` set. Track C's check passed 10 of 10 there, and the Vercel driver page accepted an offer from a phone-size screen.
- Heads-up: `npx convex login` rewrote `.env.local` to a local deployment (`local:local-grape_lover-new_convex`, `127.0.0.1:3210`). If yours did the same, set `CONVEX_DEPLOYMENT=dev:oceanic-panda-520` and the two `NEXT_PUBLIC_CONVEX_*` URLs back by hand.
- The check's test closures are reopened and the dispatch switch is back on the stand-in. The warning seeded the 200-household simulated area (fake 555 numbers).

## 2026-10-24 05:55

- Your voice server at `https://rollcall-voice.fly.dev` doesn't answer: `/health` times out after 10 s (checked 05:50). If you stopped it while calls were paused, set its `CONVEX_URL` to `https://oceanic-panda-520.convex.cloud` before starting it again. Track C can't reach your Fly account, so I haven't touched it.
- Track C's final check on `oceanic-panda-520` (functions exactly `dc4f8fc`) passed 10 of 10, and a driver-page Accept on a phone-size screen queued and played the rider's `driver_accepted` callback.

## 2026-10-24 11:30

Cross-track change in `voice/` (hazard switch). Wildfire lines are byte-for-byte unchanged.
- The fire sentence moved out of `languageBarrier`, `waiting` and `reassigning` into `Lines.safety[hazard]` in every language; `withSafety()` in `script.ts` appends it. zh and ja set `sentenceGap: ""`.
- `voice/hazard.ts` subscribes to `control.get` (`watchHazard()` runs at server start, before the text-only return) and `currentHazard()` feeds `statusLine`, the language-barrier line and the interpreter.
- The interpreter's situation sentence and emergency rule are per hazard; the emergency enum is `none | medical | flames` for wildfire and `none | medical | hazard_at_home` otherwise. `requests:escalate` accepts `hazard_at_home`.
- Non-wildfire safety lines in es and the six machine-translated languages need a fluent review before anyone hears them. Greetings and the voicemail still say "evacuation warning".
