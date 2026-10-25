# Notes from Track A to Track D

## 2026-10-24 01:47

- `riders:importCsv` now skips rows whose phone number is already on file, so re-uploading the sample is safe.
- `/system` reads `data/eval-results.json` through `/api/results` and shows the raw JSON until you tell me the shape.
- The rescue map still draws the stand-in radial fire. Tell me when `data/hazard/scenario.geojson` lands and I'll draw it.

## 2026-10-24 06:05

- I changed `estimates:state` in `convex/estimates.ts`, which is your file. It now has an explicit `returns` validator and returns the four fields your note documents: `{ smoothing, doorAlpha, lastRunAt, stats }`. Before this it was typed as `{ smoothing: boolean }`, so `lastRunAt` and `stats` were unreachable from the client and the plan panel could not tell whether your runner was alive. Nothing about what is stored changed.
- The `inputs` handler was refactored into named helpers (`toHouseholdInput`, `toNominationInput`, `toClosureInput`, `matchedHouseholdIds`, `zoneInput`) to get under the complexity hook. Same output as before.
- The plan panel now reads `estimates:state` and shows a "Neighbour smoothing" switch bound to `estimates:setSmoothing({ enabled })`, with `lastRunAt` as the hint line. `stats` is not shown yet; tell me which counts are worth a row.
- The rescue map draws your `data/hazard/scenario.geojson` fronts. The nested burn polygons are translucent red and the next front is a dashed red line. Your `label` ("Scenario input, not a forecast") is on the fire scrubber, which moves `minutesAfterWarning` from 0 to the last front.
- `nominations:flagged` is listed above `nominations:open` in the same panel, with your `note` in red. `nominations:matchAddress` needs nothing from me.

## 2026-10-24 07:40

- Additive change to `convex/offers.ts` `withContext`, which feeds both `offers:forVehicle` and `offers:active`: the row now also carries `needsLift` and `deadlineAt` from the request, and a `rider` object built from the household (`residentName`, `language`, `peopleCount`, `mobility`, `assistanceRequired`, `medical`, `pets`). Nothing was removed or renamed, so anything reading `offers:active` sees every field it saw before.
- The driver page reads `rider.medical` and `rider.mobility` to decide which door warnings to show (oxygen, two-person lift, bedbound). If those fields mean something narrower to your model than they look like, say so and I will key off the request instead.
- The plan panel now shows all six of your stat rows, in your order, above the smoothing switch. `lastRunAt` older than 15 s reads as "Stand-in or stopped".

## 2026-10-24 03:50

- `estimates:agentLines` now also returns `latencyMs` (null when the line has none). It's additive, so the grader is unaffected. The under-the-hood screen uses it for live p50 and p95 and falls back to `eval-results.json` `latency` when no real call has logged one.
- The under-the-hood screen now reads `door-fairness.json` and `honesty-results.json` through `/api/results`. Every number shows its range, and each file's `label` sits under its panel.

## 2026-10-24 13:10

Boris asked for a Ready check (a census of households ahead of time) and a pickup check (calling prearranged helpers when the warning goes out). The plan is in PLAN.md under "Ready check and pickup check". For you:

- **A household with a Ready check profile sets `needPrior`** from what it told us: 0.9 for limited mobility, oxygen, a two-person lift, no car or "I need a ride"; 0.1 for "own car, everyone walks". Your need model and door-check score can treat these as known need, like the rider list.
- **The Ready check stand-in reads personas** to fill profiles before the warning, the same way the voice stand-in does. Real agents still never read them.
- New fields: `households.ready` and the `pickupPlans` table (shapes in `convex/schema.ts`).


## 2026-10-24 15:25

The 6pm gate is gone from PLAN.md, at the team's request. Nothing is held back until a checkpoint any more: each track finishes its whole list, add-ons included, and the add-ons lose their one-hour timebox. Each track section now has one list in place of "Before the gate" and "After the gate". Please also run the full Rider Check flow end to end as soon as real calls work, and again after every big change.


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

The voice agent has a new question your resident simulator will hear. When someone says "wheelchair" without the kind, it asks "Is it a power wheelchair, the kind with a motor?" (Spanish: "¿Es una silla de ruedas eléctrica, de las que tienen motor?"). It asks again as "Just to check: does the wheelchair run on a battery?" Please answer yes or no from the persona's truth: yes for `power_wheelchair`. The read-back now says "someone uses a manual wheelchair" (Spanish "alguien usa silla de ruedas manual") where it used to say "someone uses a wheelchair", so `scripted_agent.py` and anything matching that line should change too. Both changes come from what Palo Alto Fire told us at Station 1.

## 2026-10-24 18:20

I added an Eaton Fire replay to `modeling/` and touched none of your files. `rollcall_d/eaton.py` parses the UL FSRI timeline dataset, the dispatch, radio and alert records for the night, and places each record by its block using your `AddressBook` and the road graph. `rollcall_d/eaton_replay.py` replays every documented request for help west of Lake Avenue against the real order times, with AccessLA vans from 4 a.m. It also runs a fleet check over your `population.json`. The inputs are `data/eaton/help-requests.json` (reviewed by hand, every FSRI row cited) and `data/eaton/orders.json`. The output is `data/eaton/replay-results.json`. Run it with `uv run python scripts/fetch_eaton.py` and then `scripts/eaton_replay.py`; `tests/test_eaton.py` covers the parsing. The raw FSRI CSV is git-ignored because its license isn't stated. Please check `needs_ride` there against your `outcome_of`. I mirrored `convex/model.ts` but didn't import yours.

## 2026-10-24 19:35

`transcriptLines` now also holds pickup-check and Ready-check calls. Their `calls` row has a `flow` field (`{ kind: "pickup", ... }` or `{ kind: "ready" }`), and their agent lines carry no `requestStatus`. If the honesty or alignment readers pull lines straight from Convex, filter on `calls.flow` being absent to keep only warning and inbound calls, or grade the pickup lines on their own terms.

## 2026-10-24 19:55

Every night is now kept, and there's a rewind (`convex/nightRuns.ts`). The contract only gains things: two new tables and one optional `control` field.

- **`control:rewind`** goes back to before the Ready check on the same homes. It saves the night, clears the night's tables, and puts every home and arranged pickup back as they were when the run started. Zones and personas stay. Stand-in switches are kept.
- **`control:reset`** still clears everything, homes included, but saves the night first. It also refuses while a real call is live, the same as the rewind.
- **Where it's kept:** `nightRuns` holds one row per night (`startedAt`/`endedAt` on the wall clock, `warningIssuedAt`, `hazard`, `endedBy`, `savedRows`). `nightRunRows` holds the saved documents: `start` rows are the homes and pickups when the run began, `end` rows are everything the night left. Read them with `nightRuns:list` and `nightRuns:rows({ runId, table, kind, paginationOpts })`.
- **When a run starts:** `ready:start` or `control:issueWarning`, whichever comes first after the last rewind. Both refuse while `control.archivingRunId` is set, which is while the copy runs, in batches.
- **Tables a rewind clears:** transcriptLines, texts, calls, events, callbacks, auditLog, assignments, plans, requests, nominations, roadClosures, neighborCalls, pickupPlans, vehicles, shelters, vehicleRoutes, vehicleLoads, dispatchState. That's what reset already cleared, less the setup. `callPlans`, the mesh tables and the prepare tables are untouched, as before.
- **Readers keyed to a night:** nothing to change. After a rewind, `warningIssuedAt` is unset and the next warning gets a new one.

## 2026-10-24 19:55

From now on my notes go in `notes/boris-to-everyone.md` and `notes/boris-to-<name>.md`. Please write yours as `notes/<you>-to-boris.md`. See `AGENTS.md`.
