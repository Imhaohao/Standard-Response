# Notes from the sponsor lead (CSO) to Track C

## 2026-10-24 11:38

The Convex Aggregate component is in, for call-floor counts and to cut the Database I/O overage (13 GB used of the 2 GB free limit, mostly from the tick loop). Since you own the shared deployment, **one action for you after your next push: run `npx convex run householdCounts:backfill` once.** It rebuilds both aggregates in pages of 200, then sets `control.householdCountsReadyAt`, and `households:counts` switches from the scan to the aggregate. Run it again any time to repair.

- **Every Convex mutation now comes from `convex/functions.ts`**, not `./_generated/server`. I changed the import line in 19 files, including yours. Lint fails any new `mutation` or `internalMutation` imported from `./_generated/server`, because that would skip the household trigger and drift the counts. Queries, actions and the `MutationCtx` type still come from `./_generated/server`.
- Writes to `households` are unchanged for callers. A trigger updates two Aggregate components (`householdsByOutcome`, `householdsByCallStatus`) only when `outcome` or `callStatus` changes, so need-estimate and record writes don't touch them.
- `convex/convex.config.ts` is new (it installs the two components), and so are `@convex-dev/aggregate` and `convex-helpers` in `package.json`. Run `npm install` after you pull.
- Tested with convex-test on an in-memory backend: rider import, call start and end, a record update, `clearTables` and a re-import all match a full scan. The test fails when the trigger is removed. I didn't commit the test, because vitest conflicts with our `@types/node` 20.
- Still the biggest readers, unchanged and yours: the fallback need model scanning households every tick (`sim.ts:153`), and `fleet.tick` re-reading closures, vehicles and routes. Insights also show `dispatch.commit` failing for good 5 times on OCC conflicts with `fleet.tick` vehicle writes.

## 2026-10-24 13:48

**The team is moving to the Convex deployment `robust-penguin-834`.** It already has `main` pushed (schema, every function, both Aggregate components), with `SOLVER_URL` and `SOLVER_TOKEN` set to the DigitalOcean solver (health 200). It holds no data until someone issues a warning on the call floor; Reset and Issue warning seed it as usual. Replace the three Convex lines in your `.env.local` with:

```
CONVEX_DEPLOYMENT=dev:robust-penguin-834
NEXT_PUBLIC_CONVEX_URL=https://robust-penguin-834.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://robust-penguin-834.convex.site
```

Then restart `npm run dev` and anything else that read the old URL at start. Pull `main` before running `npx convex dev`, because that command pushes your local `convex/` over everyone's. `oceanic-panda-520` stops being the shared one now.

**Track C, one action:** you own the Vercel app (`https://rollcall-blush.vercel.app`). Set `NEXT_PUBLIC_CONVEX_URL=https://robust-penguin-834.convex.cloud` (and `NEXT_PUBLIC_CONVEX_SITE_URL=https://robust-penguin-834.convex.site`) in its environment, then redeploy. `NEXT_PUBLIC_` values are baked in at build time, so a redeploy is required. The solver itself needs no change.

## 2026-10-24 14:10

**Bug: the "No vehicle" badge never clears.** `escalateUnservable` (`convex/dispatch.ts:183`) sets `households.escalation = "unservable"` when a plan has no vehicle for a home. Nothing clears it when a later plan does give that home a vehicle. The rescue map then shows a red "No vehicle" badge and "Van 3" on the same row, which breaks the honesty rule on the dispatcher's own screen.

Measured on `oceanic-panda-520` 36 minutes into a stand-in run: 47 households flagged `unservable`, 29 of them `en_route` and 13 `arrived`.

Suggested fix, yours to pick: in `dispatch.commit`, clear `escalation` when it is `"unservable"` for every household that gets a kept offer. Leave the other escalations (`medical`, `flames`, `address_unconfirmed`, `language_barrier`) alone, because those must stay red until a person handles them. `dispatch/verify_dispatch.py:264` checks only that the flag is set, so a check that it clears after a later offer would cover this.

## 2026-10-24 16:02

Deployed to `robust-penguin-834`: the `workflow` component (reach ladder) and `POST /apify/zone-status` (Convex HTTP action, secret in env `APIFY_WEBHOOK_SECRET`, also in the repo's `.env.local`). Checked live: a wrong secret returns 401, and a zone with no riders returns `noRiders: 1` with nothing written. Watch usage: each unreached real rider's workflow wakes every 20 s while waiting.

## 2026-10-24 19:45

**Additive change to your `roadClosures` table**, for the Apify prize. Apify's real road closures now reach dispatch. Nothing you call changes.

- `closureSource` gains `"apify"`. `roadClosures` gains an optional `sourceKey` (for example `"caltrans-lcs:<id>"`) and the index `by_sourceKey`.
- New endpoint `POST /apify/road-closures` (`convex/http.ts`), with the same `APIFY_WEBHOOK_SECRET` as the zone endpoint. It runs `internal.apify.applyClosures`. A `closed` closure is written through the new `insertClosures` helper in `convex/roads.ts`, which `roads:addClosures` now also uses. Its behavior is unchanged, plus a dedupe on `sourceKey`. A `lifted` closure deletes only the `apify` row with that `sourceKey`. Your closure count in `maybeReplan` changes either way, so both trigger a re-plan.
- **Snapping:** Caltrans gives a closure as its two ends, and the straight line between them can cut across open streets. `closedEdgesFor` would close every street it crosses. So `applyClosures` uses a new `edgesRunningAlong(path)` in your `convex/roadGraph.ts`, which only takes edges the line runs along, and writes `edgeKeys` and `streets` already set. `snapClosures` then leaves those rows alone. A closure that runs along none of our streets is counted as `offOurRoads` and not written.
- Every Apify row is `confirmed: true`, because Caltrans reports closures it has made.
- Tests: `npx vitest run apify/tests --environment edge-runtime` (7 new cases: snapped write, repeat ignored, lift reopens, a lift never removes a manual closure, crossing-only and far-away lines close nothing, bad input ignored, 401/400).
- Not deployed to `robust-penguin-834` yet. Whoever runs `npx convex dev` or deploy next pushes it. The schema change is additive.

## 2026-10-24 19:36

Deployed `main` at `c811a9d` to `robust-penguin-834`, from a clean copy of `origin/main`, because the shared folder has uncommitted `convex/` edits. Indexes added: `roadClosures.by_sourceKey`, plus `assignments.by_requestId_and_status` and `requests.by_householdId_and_status`, which were already on `main`. Checked live: `POST /apify/road-closures` with a wrong secret returns 401, and `apify:applyClosures` with a closure near Sacramento returns `offOurRoads: 1` and writes nothing.
