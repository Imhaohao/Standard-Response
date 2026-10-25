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

Convex runs each mutation as one serializable transaction, and every rule that lives inside one
mutation held under every storm:

| Scenario | Storm | Result |
| --- | --- | --- |
| double-accept | 25 offers, each accepted by 12 phones at once | Exactly one accept wins per offer, the other 11 hear `"changed"`, and one callback is queued |
| accept-vs-end | 30 offers; at once on each: 3 accepts, 2 declines, 2 expiry timers, 2 re-plans replacing it, 1 cancel | Every offer ends in one state, the request status matches it, and the rider is called only when an accept won |
| cancel-storm | 15 accepted pickups; 8 "Can't make it" taps and 4 late accepts each | One `reassigning` callback each; every late accept hears `"changed"` |
| propose-race | 8 dispatchers offer the same 20 requests; 6 whole plans race for 10 more | One live offer per request, one whole plan wins, and plan versions run 1..N with no gaps |
| correction-vs-accept | 2 accepts vs 2 "needs a two-person lift" corrections, on one-person vans | No live assignment is left on a van that can't serve; an accepted one is revoked and the rider called |
| close-vs-accept | 2 accepts vs 2 "I can leave on my own" | Request closed, no live assignment, no `reassigning` call |
| stale-dispatch | 4 re-plans commit plans solved before 8 accepts and 6 closes landed | Accepted pickups stay with their driver; closed requests get no new offer (`dispatch.commit` re-validates) |
| inbound-same-number | 10 unknown numbers, each calling in 25 times at once | One household per number |
| chaos | 8 rounds of 120 random writes from stale views: commits, accepts, declines, expiries, cancels, corrections, riders leaving and coming back | Every contract invariant holds |

## What it found, now fixed

Every scenario passes now. These are the four bugs the first runs found, and what changed.

### 1. Reads that stopped early missed live rows after enough churn

`liveAssignmentsFor`, `liveAssignmentsForVehicle`, `openRequestFor` and the status line's driver
lookup in `voice.ts` read the oldest 50, 100 or 20 rows and only then filtered for live ones. Every
re-plan that changes an offer and every 2-minute expiry leaves a dead row, so on a long night the
live rows fell past the limit:

- **request-churn:** after 60 re-plans of one request, `plans:propose` let a second live offer
  through. A correction no longer dropped the offer the van couldn't serve, and closing the request
  left both offers live.
- **vehicle-churn:** after 110 replaced offers on one van, the driver page (`offers:forVehicle`)
  lost the van's accepted stop, and an offer could be placed ahead of it, which breaks the
  frozen-run rule.
- **household-churn:** a rider who flipped between "I can leave" and "I can't" 25 times ended with
  7 open ride requests instead of 1.

**Fix:** these reads go through the status in an index (`assignments.by_requestId_and_status`,
`requests.by_householdId_and_status`, and the existing `by_vehicleId_and_status_and_stopOrder`).

### 2. `plans:propose` offered rides to requests that had already closed

In **stale-propose**, an outside solver proposed for 5 requests that closed while it solved. All 5
offers went live, and the driver's accept then threw `cannot move from closed to driver_accepted`
instead of answering `"changed"`. `dispatch.commit` already checked for this; the public mutation
didn't.

**Fix:** `plans:propose` refuses an offer unless the request is `received`, `approved` or
`reassigning`. The same `OFFERABLE` set in `convex/requests.ts` now backs both paths.

### 3. Household writes conflicted through the household counts

Every household write updated the two aggregates behind `households:counts` in its own
transaction. With nodes of 16, a namespace is only a few B-tree leaves, so writes for *different*
homes conflicted. When Convex's retries ran out, the whole write failed. No invariant broke, but the
answer was lost, and the voice agent's record writes are fire-and-forget:

- **concurrent-corrections:** with 450 updates to 150 households sent at once, 55 to 60% gave up.
- **call-floor-load:** with 12 calls each saving 30 answers in a row, 1 to 7 of 360 gave up. That's
  at 120 to 235 writes a second, far faster than a real call floor.

**Fix:** the trigger queues its aggregate writes to the aggregate's batch worker, and
`households:counts` reads stale. Both scenarios now lose nothing. The counts trail the records by
moments, and the scenario checks that they catch up within 10 seconds.

Two side effects of the fix:
- `householdCounts:backfill` must run while no household is being written, because clearing needs
  an empty queue.
- convex-test files register the counts with `registerHouseholdCounts(t)` from
  `tests/workflow/householdCounts.ts`. Aggregate's own test helper doesn't register the nested
  batch worker.

Writes that give up on one shared document are expected, and are reported but not failed:
- `plans`: the plan version counter, when many proposals race.
- `households`: the same caller ringing 25 times at once.
- `dispatchState`: concurrent commits, which the re-plan lock prevents in practice.

### 4. Callback state could move backwards

In **callback-ordering**, a `placed` or `unanswered` that landed after `played` moved the callback
back, and `unanswered` is what starts a retry call.

**Fix:** a played callback stays played.

## Not covered

- The pickup check (`pickups:*`).
- The ready check.
- Scheduled loops running during a storm (`sim:tick`, `dispatch:replan`). The harness calls
  `offers:expire` and `dispatch:commit` directly instead.
- Throughput and latency, beyond the conflict rates above.
