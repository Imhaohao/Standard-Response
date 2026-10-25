# Convex stress test

`npm run stress:convex` fires conflicting writes from many clients at once at the real contract,
then checks the contract's promises from the raw tables. It starts its own throwaway Convex backend
(the binary `npx convex dev --local` downloads) on free ports with an empty database and deploys
`convex/` to it. The deployment in `.env.local` is never written to, the stand-in loops stay off,
and nothing places a call, sends a text or reaches a solver. One run takes about a minute.

```bash
npm run stress:convex
npm run stress:convex -- double-accept chaos
npm run stress:convex -- --keep
```

The first command runs every scenario, the second runs only the scenarios it names, and `--keep`
leaves the backend's temp directory (and its log) behind. The code is in `scripts/stress/`. Each
scenario sets up its own fictional riders through the CSV import, so scenarios don't depend on each
other. The exit code is non-zero when any check fails.

## What holds

Convex runs each mutation as one serializable transaction, so every rule that lives inside one
mutation can be checked under a storm of conflicting writes. Each scenario checks one:

| Scenario | Storm | What must hold |
| --- | --- | --- |
| double-accept | 25 offers, each accepted by 12 phones at once | Exactly one accept wins per offer, the other 11 hear `"changed"`, and one callback is queued |
| accept-vs-end | 30 offers; at once on each: 3 accepts, 2 declines, 2 expiry timers, 2 re-plans replacing it, 1 cancel | Every offer ends in one state, the request status matches it, and the rider is called only when an accept won |
| cancel-storm | 15 accepted pickups; 8 "Can't make it" taps and 4 late accepts each | One `reassigning` callback each; every late accept hears `"changed"` |
| propose-race | 8 dispatchers offer the same 20 requests; 6 whole plans race for 10 more | One live offer per request, one whole plan wins, and plan versions run 1..N with no gaps |
| correction-vs-accept | 2 accepts vs 2 "needs a two-person lift" corrections, on one-person vans | No live assignment is left on a van that can't serve; an accepted one is revoked and the rider called |
| close-vs-accept | 2 accepts vs 2 "I can leave on my own" | Request closed, no live assignment, no `reassigning` call |
| stale-dispatch | 4 re-plans commit plans solved before 8 accepts and 6 closes landed | Accepted pickups stay with their driver; closed requests get no new offer (`dispatch.commit` re-validates) |
| stale-propose | An outside solver (`plans:propose`) offers rides to requests that closed while it was solving | No offer goes live |
| request-churn | One request re-offered 60 times, then a second offer, a correction and a close | One live offer per request, a correction drops the offer the van can't serve, and the close leaves no live offer |
| vehicle-churn | One van offered 110 pickups that later plans replaced, then one accepted stop and an offer that would cut in front of it | The driver page (`offers:forVehicle`) keeps the accepted stop, and no offer is placed ahead of it |
| household-churn | One rider flips between "I can leave" and "I can't" 25 times | One open ride request |
| concurrent-corrections | 450 record updates to 150 households at once | No write is lost, and `households:counts` matches the records within 10 seconds |
| call-floor-load | 12 calls at once, each saving 30 answers in a row | No write is lost |
| inbound-same-number | 10 unknown numbers, each calling in 25 times at once | One household per number |
| callback-ordering | 10 played callbacks, then a late `placed` and a late `unanswered` from the same call | Each callback stays played, so no retry call starts |
| chaos | 8 rounds of 120 random writes from stale views: commits, accepts, declines, expiries, cancels, corrections, riders leaving and coming back | Every contract invariant holds |

## How the contract stays true

- **Live rows are read through an index on status.** Every re-plan that changes an offer and every
  2-minute expiry leaves a dead row, so on a long night a read of the oldest rows would miss the live
  ones. `liveAssignmentsFor`, `liveAssignmentsForVehicle`, `openRequestFor` and the status line's
  driver lookup in `voice.ts` read through `assignments.by_requestId_and_status`,
  `requests.by_householdId_and_status` and `by_vehicleId_and_status_and_stopOrder`.
- **Only open requests get offers.** `plans:propose` refuses an offer unless the request is
  `received`, `approved` or `reassigning`. The same `OFFERABLE` set in `convex/requests.ts` backs
  `dispatch.commit`.
- **Household counts don't conflict with household writes.** The trigger queues its aggregate writes
  to the aggregate's batch worker, and `households:counts` reads stale. The counts trail the records
  by moments.
- **A played callback stays played.** A `placed` or `unanswered` that lands later can't move it back,
  and `unanswered` is what starts a retry call.

Two consequences of the household counts design:
- `householdCounts:backfill` must run while no household is being written, because clearing needs
  an empty queue.
- convex-test files register the counts with `registerHouseholdCounts(t)` from
  `tests/workflow/householdCounts.ts`. Aggregate's own test helper doesn't register the nested
  batch worker.

Writes that give up on one shared document are expected, and are reported but not failed:
- `plans`: the plan version counter, when many proposals race.
- `households`: the same caller ringing 25 times at once.
- `dispatchState`: concurrent commits, which the re-plan lock prevents in practice.

## Not covered

- The pickup check (`pickups:*`).
- The ready check.
- Scheduled loops running during a storm (`sim:tick`, `dispatch:replan`). The harness calls
  `offers:expire` and `dispatch:commit` directly instead.
- Throughput and latency.
