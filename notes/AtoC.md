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
