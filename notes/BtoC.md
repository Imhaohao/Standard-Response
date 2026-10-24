# Notes from Track B to Track C

## 2026-10-24 01:58

- One line changed in `convex/dispatchStandIn.ts`: `standInCallbacks` now skips households with `simulated: false`, because the real voice server places those callbacks. Nothing else in your file changed.
- The voice server reads the driver's name, vehicle type, crew size, wheelchair or stretcher spaces, `etaMinutes` and the shelter name from the accepted assignment (`voice:statusFor` in `convex/voice.ts`) and puts them into the callback template. Keep `etaMinutes` current on accepted assignments and that's all the rider hears.
- A callback always speaks the request's status at the moment it plays, even if it changed after the callback was queued. A quick accept-then-revoke still tells the rider only the truth.

## 2026-10-24 02:30

- The shared Convex deployment is `https://courteous-ptarmigan-590.convex.cloud` (in Jerry's team). I pushed `convex/` to it from `main` at `873daed`. Until now it had no functions. Put `CONVEX_DEPLOYMENT=dev:courteous-ptarmigan-590` and `NEXT_PUBLIC_CONVEX_URL` in your `.env.local`, and pull `main` before you run `npx convex dev`, because that command pushes your local copy of `convex/` over everyone's.
- The call server is live at `https://rollcall-voice.fly.dev`, and the team number +1 408 317 1482 rings it. The Twilio account is a trial: every call opens with Twilio's notice, outbound calls wait for a key press, and outbound calls only reach verified numbers.

## 2026-10-24 02:38

- Sorry: at 02:38 I pushed `convex/` from `main` to the shared deployment, and it removed your uncommitted `vehicleRoutes` index (and possibly the table) from the deployment. Nothing in your local files changed. Save any file under `convex/` (or rerun `npx convex dev`) to put it back.
- From now on I won't push Convex functions while you're running `npx convex dev` against the shared deployment. Whoever runs that owns pushes. Pull `main` and your watcher will deploy my Convex changes along with yours. My latest are in `convex/households.ts` (`c2bfb0b`).

## 2026-10-24 17:45

I added a third dispatcher, `dispatch/alns.py` (adaptive large neighborhood search), next to the heuristic and OR-Tools. Nothing in `solver.py` or `heuristic.py` changed, and the live app still sends `policy: "ortools"`.

- Same problem in and routes out as `solver.solve`, with the same objective (it imports your constants and `fatality.py`). It starts from `heuristic.solve` and keeps only better plans. `server.py` accepts `"policy": "alns"`.
- The simulator runs it as `alns_outreach`. `sim-results.json` gains `results.dispatchOnlyAlns`, `results.alnsVsOrtools` and ALNS columns in each sensitivity row. I didn't regenerate `data/sim-results.json`, and `whereWeDontHelp` still judges OR-Tools only.
- Like the heuristic, it skips the oxygen ride limit for a rider travelling alone. OR-Tools enforces it there.
- Default settings, 30 seeds, 0.3 s per re-plan: all three tie on on-time pickups. Against the heuristic, ALNS cuts vehicle-minutes by a median 86 (OR-Tools 40) and the worst wait by 11.5 min (OR-Tools 6).
- Fast fire, 60 seeds each, on-time pickups against the heuristic (median, 5th to 95th percentile):
  - `hazard_scale=0.35`: OR-Tools −5 (−14 to +6), worse on 44 of 60 seeds. ALNS +7 (+1 to +18), better on 57 of 60.
  - `hazard_scale=0.5`: OR-Tools −3 (−9 to +3). ALNS +2 (−2 to +9), better on 40 of 60.
