# Notes from Track C to Track A

## 2026-10-24 02:45

- Track C's real dispatcher is in. Turn off "Dispatcher and vehicle movement" and `convex/fleet.ts` + `convex/dispatch.ts` take over: OR-Tools (or the heuristic when the solver service is down) re-plans every 5 s and right away when a road closes, and vehicles drive real OSM road paths.
- Solver panel: `plans` rows now carry `requestCount`, `vehicleCount` and `fallbackReason` (why the heuristic ran). `dispatch:status` returns `{ state, latestPlan, solverConfigured }`; `state` has `lastSolver`, `lastSolveMs`, `lastFallbackReason`, `lastError`, `replans`.
- Rescue map: `dispatch:routes` returns `{ vehicleId, target, boarding, remaining }` per vehicle, where `remaining` is the road path still to drive (points). Draw it as the van's route; `boarding: true` means it's parked at a pickup.
- Your manual closure gets snapped on the next re-plan: `roadClosures.edgeKeys` (both directions) and `streets` (names, e.g. "Lincoln Avenue") fill in. A line drawn along a road closes that road; a line drawn across roads closes every road it cuts.
- Simulated vehicles drive and board 4x real time (`SIMULATED_TIME_LAPSE` in `convex/vehicleRun.ts`). ETAs and deadlines stay in real minutes. Please label vehicle movement "simulated, 4x".
- Request status now reaches `arrived` when the van reaches the door and `closed` at the shelter. Pickups, drop-offs and revocations write `events` with kind `dispatch`.
- I added `vehicleRoutes` and `dispatchState` to the reset list in `convex/control.ts`.
- `data/sim-results.json` shape comes in a later note, with the file.

## 2026-10-24 03:05

- One line added to your `control.ts` `issueWarning`: `seedFleetIfEmpty(ctx, now)`. The cloud deployment had a real rider list but no vehicles or shelter, because the full seed only runs when `households` is empty. Now the warning always leaves a fleet to dispatch. `vehicles:ensureFleet` does the same on demand.

## 2026-10-24 03:20

- `data/sim-results.json` has landed (100 paired seeds, `dispatch/sim/`, rerun with `cd dispatch && uv run python -m sim.run --seeds 100`). Top level: `label` ("Simulation, not a prediction", show it), `seeds`, `population`, `assumptions` [{name, value, why}], `metricDefinitions`, `results`, `sensitivity`, `whereWeDontHelp`, `exploration`, `integrity`.
- `results.dispatchOnly | outreachOnly | combined` each have `policies.<name>.<metric>`, `difference.<metric>` (second policy minus first, per seed) and `headline` (a ready sentence). `results.todayProcess` has `metrics` and `headline`. Every metric is `{median, p5, p95, n}`; show it as "median (p5 to p95)". The primary metric is `pickupsOnTime`.
- Honest headline for the under-the-hood screen: on identical requests OR-Tools is not ahead of the heuristic yet (median -2, range -6 to 0). The gain comes from outreach (+53 on-time pickups, range +44 to +64) and depends on the 911 assumptions listed in `assumptions`. Show `whereWeDontHelp` as written.

## 2026-10-24 03:30

- `dispatch:routes` now returns `[]` while the dispatch stand-in is on, since its straight-line movement doesn't follow those paths.
- Track C's cloud check is done; its 17 test closures are reopened and the dispatch switch is back on the stand-in.

## 2026-10-24 04:30

- `vehicles:list` positions now update every 2.5 s instead of every tick (busy re-plans were conflicting with them). For smooth vans, use `position` from `dispatch:routes`, which updates every tick, or animate between `vehicles:list` positions.
- OR-Tools is live on the cloud (DigitalOcean). The solver panel should now show `solver: "ortools"` with solve times around 2 to 3 s.
