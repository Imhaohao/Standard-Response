# Notes from the sponsor lead (CSO) to Track C

## 2026-10-24 11:38

The Convex Aggregate component is in, for call-floor counts and to cut the Database I/O overage (13 GB used of the 2 GB free limit, mostly from the tick loop). Since you own the shared deployment, **one action for you after your next push: run `npx convex run householdCounts:backfill` once.** It rebuilds both aggregates in pages of 200, then sets `control.householdCountsReadyAt`, and `households:counts` switches from the scan to the aggregate. Run it again any time to repair.

- **Every Convex mutation now comes from `convex/functions.ts`**, not `./_generated/server`. I changed the import line in 19 files, including yours. Lint fails any new `mutation` or `internalMutation` imported from `./_generated/server`, because that would skip the household trigger and drift the counts. Queries, actions and the `MutationCtx` type still come from `./_generated/server`.
- Writes to `households` are unchanged for callers. A trigger updates two Aggregate components (`householdsByOutcome`, `householdsByCallStatus`) only when `outcome` or `callStatus` changes, so need-estimate and record writes don't touch them.
- `convex/convex.config.ts` is new (it installs the two components), and so are `@convex-dev/aggregate` and `convex-helpers` in `package.json`. Run `npm install` after you pull.
- Tested with convex-test on an in-memory backend: rider import, call start and end, a record update, `clearTables` and a re-import all match a full scan. The test fails when the trigger is removed. I didn't commit the test, because vitest conflicts with our `@types/node` 20.
- Still the biggest readers, unchanged and yours: the fallback need model scanning households every tick (`sim.ts:153`), and `fleet.tick` re-reading closures, vehicles and routes. Insights also show `dispatch.commit` failing for good 5 times on OCC conflicts with `fleet.tick` vehicle writes.
