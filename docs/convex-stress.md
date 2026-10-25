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

## What breaks

### 1. Reads that stop early miss live rows after enough churn

`liveAssignmentsFor` reads the first 50 assignments of a request and `liveAssignmentsForVehicle`
reads the first 100 of a vehicle ([convex/offers.ts:18](../convex/offers.ts#L18),
[convex/offers.ts:26](../convex/offers.ts#L26)), oldest first, and only then filters for live ones.
Every re-plan that changes an offer and every 2-minute expiry adds a dead row, so on a long night
the live rows fall past the limit.

- **request-churn:** after 60 re-plans of one request, `plans:propose` lets a second live offer
  through. A correction no longer drops the offer the van can't serve, and closing the request
  leaves both offers live.
- **vehicle-churn:** after 110 replaced offers on one van, `offers:forVehicle` (the driver page)
  doesn't show the van's accepted stop. `plans:propose` also accepts an offer ahead of that stop,
  which breaks the frozen-run rule. `dispatch.commit`'s `firstFreeStop` reads the same list.

`openRequestFor` has the same shape with 20 ([convex/requests.ts:55](../convex/requests.ts#L55)).

- **household-churn:** a rider who flips between "I can leave" and "I can't" 25 times ends with
  7 open ride requests instead of 1.

A likely fix is to read live rows by status through an index (`by_vehicleId_and_status_and_stopOrder`
already exists for vehicles; requests need a `by_requestId_and_status`).

### 2. `plans:propose` offers rides to requests that already closed

`assertOfferAllowed` ([convex/plans.ts:39](../convex/plans.ts#L39)) checks compatibility and live
offers but not the request's status. In **stale-propose**, an outside solver proposes for 5 requests
that closed while it solved. All 5 offers go live, and the driver's accept then throws `cannot move
from closed to driver_accepted` instead of answering `"changed"`. The built-in dispatcher is safe,
because `dispatch.commit` checks `OFFERABLE` first. The exposure is the public mutation, which outside solvers write through
(`dispatch/verify_dispatch.py` describes OR-Tools doing so), as do the red-team change cases.

### 3. Household writes contend on the household counts

Every write to `households` also updates the two aggregates behind `households:counts`
([convex/householdCounts.ts:19](../convex/householdCounts.ts#L19)). Those B-trees share nodes, so
writes to different households conflict with each other. When Convex retries and still loses, the
whole write fails. Nothing partial stays, so no invariant broke, but the answer is lost unless the
caller retries.

- **concurrent-corrections:** 450 updates to 150 different households, all sent at once: about 55
  to 60% give up on a `btreeNode` conflict.
- **call-floor-load:** 12 calls at once, each saving 30 answers in a row to its own household: 1 to 7
  of 360 are lost (0.3 to 2%). That run makes 120 to 235 writes a second, far more than a real call
  floor, so treat it as an upper bound.

The voice agent's record writes are fire-and-forget (PLAN.md, Track B), so a lost write is a lost
answer. The aggregate's `rootLazy` and `maxNodeSize` options, or a retry on the caller's side,
are where to look.

Conflicts on one shared document are expected and are reported but not failed:
- `plans`: the plan version counter, when many proposals race.
- `households`: the same caller ringing 25 times at once.
- `dispatchState`: concurrent commits, which the re-plan lock prevents in practice.

### 4. Callback state can move backwards

`markPlaced` and `markUnanswered` overwrite the state unconditionally
([convex/callbacks.ts:38](../convex/callbacks.ts#L38)). In **callback-ordering**, a `placed` or
`unanswered` that lands after `played` moves the callback back, and `unanswered` is what starts a
retry call. `voice/callbackRunner.ts` sends these in order from one process today, so this stays
latent until two paths mark the same callback.

## Not covered

- The pickup check (`pickups:*`).
- The ready check.
- Scheduled loops running during a storm (`sim:tick`, `dispatch:replan`). The harness calls
  `offers:expire` and `dispatch:commit` directly instead.
- Throughput and latency, beyond the conflict rates above.
