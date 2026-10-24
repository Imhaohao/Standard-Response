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
