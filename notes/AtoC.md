# Notes from Track A to Track C

## 2026-10-24 01:47

- I changed two things in your stand-in. Seeded vehicles now start inside the map (`convex/seed.ts`). The auto-approve sweep now lives in `sim.ts` and approves offers left "proposed" while approval was manual. Before this, those offers never expired and every vehicle locked up.
- Offers that sit in `proposed` never expire. Your solver should replace them on re-solve if they go stale.
- `/system` reads `data/sim-results.json` through `/api/results` and shows the raw JSON until you tell me the shape.
- The manual "Close a road" tool writes a two-point `path` with `source: "manual"` and no `edgeKey`. Please snap it with `roads:setEdgeKey`.
- `OFFER_TTL_MS` moved to `convex/model.ts` so the driver page can show the countdown.

## 2026-10-24 06:05

- I am drawing `dispatch:routes` on the rescue map: each vehicle's `remaining` path is a solid line once the offer is accepted and dashed while it is still being offered. `boarding: true` parks the van marker at the pickup. Nothing needed from you.
- The vehicle movement is labelled "simulated, 4x" on the rescue map toolbar, per your note.
- Your reset list in `convex/control.ts` already covers `vehicleRoutes` and `dispatchState`, so `control:reset` clears them. Thanks.
- The manual closure tool still writes a two-point `path` with `source: "manual"` and no `edgeKey`; I am relying on your snap to fill `edgeKeys` and `streets`.

## 2026-10-24 07:40

- Additive change to `convex/offers.ts` `withContext`, which feeds both `offers:forVehicle` and `offers:active`: the row now also carries `needsLift` and `deadlineAt` from the request, and a `rider` object built from the household (`residentName`, `language`, `peopleCount`, `mobility`, `assistanceRequired`, `medical`, `pets`). Nothing was removed or renamed, so your dispatcher reading `offers:active` sees every field it saw before.
- The driver page needs this because an address alone does not tell a driver whether they can take the pickup. Two people and a wheelchair is a different job from one person who walks.

## 2026-10-24 11:40

- The `unservable` escalation never clears. `escalateUnservable` in `convex/dispatch.ts` sets it once, and a later plan that does offer the household a van leaves it set. On the cloud, almost every rider with a van coming still carried "No vehicle". The rescue map now ignores `unservable` while the household has an active assignment, but other readers (call floor, the voice agent's status) still see it. Could the commit that offers a van also clear `unservable` on that household?
- The rescue map now draws each van's route along the road graph (`lib/ink-map/road-route.ts`, a shortest path over the same `drive.graphml` edges, skipping `edgeKey`/`edgeKeys` closures) whenever `dispatch:routes` has no path for it, which is always while the dispatch stand-in is on. Once your dispatcher is on, your `remaining` path wins.
- Vans also get a badge: "Changed course" when their first stop changes, "Not moving" when they have a job and haven't moved 8 m in 30 s, "Picking up" when `boarding` is true or they're within 30 m of the stop, "Idle" with no job. On `oceanic-panda-520` right now every van is frozen (positions identical 12 s apart), which looks like the sim loop stopped.

## 2026-10-24 13:10

Boris asked for a Ready check (a census of households ahead of time) and a pickup check (calling prearranged helpers when the warning goes out). The plan is in PLAN.md under "Ready check and pickup check". What touches your code:

- **`syncRequest` in `convex/requests.ts` gains one guard:** while a household's pickup plan is `checking` or `coming`, it opens no ride request, because a neighbor is on the way. When the plan falls through, `pickups.ts` calls `applyRecordPatch` with `canLeave: "no"`, and the request opens through the normal path. Nothing else in requests, offers or plans changes.
- **New table `pickupPlans`** (owned by A). Reset clears it with the others.
- **`control:issueWarning` re-times households seeded before the warning.** The Ready check seeds the simulated town early, so `fireArrivalAt`, `callPriority` and `needProbability` are recomputed from the warning time when the night starts. Fresh deployments behave exactly as before.
- Please deploy with your next `npx convex dev` after pulling. I can't reach `oceanic-panda-520` from the CLI.

## 2026-10-24 14:30

**Urgent: please run `npx convex dev` from main against `oceanic-panda-520` now.** The rescue map, call floor, driver page and `/ready` on main call new functions (`pickups:board`, `ready:card`, `ready:start`, `ready:submit` and others), plus new schema fields (`households.ready`, `pickupPlans`, three optional `control` fields). Until they're deployed, those screens fail with "Could not find public function" on the shared deployment. My CLI has no access to the project, so I can't push it myself. Everything has been run end to end on a private local backend: the Ready check, the warning, the pickup check, fallen-through pickups opening requests, and all 50 requests reaching the shelter.

## 2026-10-24 15:00

New: 911 asks a neighbor who is driving out to pick up a home that needs a ride (`convex/neighborPickups.ts`). It runs when a household's record shows a ride need (`applyRecordPatch`), when the warning goes out, and again after each "no" (up to 3 neighbors, within 800 m). It skips power wheelchairs, bedbound residents and two-person lifts.

- Contract: `pickupPlans.recruited` (optional boolean). The other fields are unchanged.
- `helperCovers` ignores recruited plans, so the ride request stays open and dispatch can still send a van. A neighbor is a faster first try, never a reason to hold a van.
- When the resident confirms a pickup (`markDone`), `syncRequest` now runs and closes the open request. For arranged helpers nothing changes, because they had no request.
- Simulated households get recruited plans too, and `pickupSim.ts` plays them like any other plan.
- Not deployed to the shared deployment.


## 2026-10-24 15:25

The 6pm gate is gone from PLAN.md, at the team's request. Nothing is held back until a checkpoint any more: each track finishes its whole list, add-ons included, and the add-ons lose their one-hour timebox. Each track section now has one list in place of "Before the gate" and "After the gate". Please also run the full Rider Check flow end to end as soon as real calls work, and again after every big change.

## 2026-10-24 15:45

`requests:open` rows now also carry `residentName` and `callbackNumber` from the household. This is additive, and nothing else in the function changed. The rescue map uses them to list callers it has no address for at the top of Rides, with a button to call them back. Until now those callers were dropped from the list entirely.

## 2026-10-24 15:30

Neighbor asks changed, ahead of a two-phone demo:

- They start only once tonight's call has heard that the person can't leave (`canLeave` is set and the outcome is `needs_ride` or `needs_accessible`). A Ready check "needs a ride" answer alone no longer sends a neighbor, and the warning-time sweep (`askNeighborsForWaitingHomes`) is gone.
- A driver can live just outside the zone: has a car (`hasCar` or a Ready check `own_car`), has a phone number, and is `leaving` or `unknown`.
- `nextToCall` now skips households 911 is asking to drive, or that are already on the way (`busyHelpers`), so their warning call doesn't collide with the pickup call.


## 2026-10-24 16:30

Dispatcher login (Auth0) is in, switched off until `AUTH0_DOMAIN` is set, so nothing changes for you today. Run `npm install` after you pull: it adds `@auth0/nextjs-auth0`. There is now a root `proxy.ts`, which is Next 16's name for middleware. While Auth0 is off it passes every request straight through, and it never touches `/api/*`. When it is on, the call floor, rescue map, under-the-hood, simulated phone and driver page need a login with a role. Public pages stay open: `/ready`, `/prepare`, `/mesh`, `/flow`. The README section "Dispatcher login (Auth0)" has the setup.

## 2026-10-24 15:42

The night now runs on a shared clock that the rescue map can pause or play at 1×, 10×, 30× or 60× (`control.clock`, `lib/sim-clock.ts`, `control:setPlayback`). Until someone presses a control, it reads the same as the wall clock, so nothing changes for you.

- **In Convex**, use `await simNow(ctx)` from `convex/clock.ts` for every time you store or compare: `at`, `createdAt`, deadlines, ring and retry waits. I switched every existing `Date.now()` in `convex/` to it. The exceptions are solve timings, the mesh and survey add-ons, and the re-plan cadence and lock in `dispatch.ts`, which stay on the wall clock so faster playback never calls the solver more often.
- **In the browser**, use `useSimNow()` from `lib/use-sim-now.ts` wherever you compare against a stored time. `useFireClock` already reads it.
- **Faster playback** moves the clock further on each 900 ms tick. It doesn't tick more often. `fleet:tick` receives `tickMs` scaled by the speed, and the dispatch snapshot carries `now` on the night's clock. While paused, the loop stops scheduling ticks, so a paused night costs nothing.
- **Real phone calls** still run at real speed, so a run with live calls is best left at 1×.
- **Stand-in vans** now drive at the 7 m/s their ETAs assume, not 60 m/s. Use 10× or more to make them visibly move.
