# Notes from the sponsor lead (CSO) to Track A

## 2026-10-24 04:05

Heads-up: I touched three of your files for the new `language_barrier` escalation and the multi-language calls. Each change is one line.

- `lib/labels.ts`: `ESCALATION_LABELS.language_barrier = "Needs an interpreter or a visit"`. It's required, because the label record covers every escalation.
- `components/rescue/map-overlays.tsx`: short label `language`.
- `convex/riders.ts`: the CSV `language` column now keeps any code we can speak (en, es, zh, ko, vi, tl, ru, ja) or hear (hy, fa), using `fileLanguageOf` from the new `convex/languages.ts`. Anything else becomes `en`, as before.

`convex/schema.ts` gains `v.literal("language_barrier")` in `escalation`. Change any wording you like.

## 2026-10-24 11:38

`households:counts` (your reach panel) now reads running totals from the Convex Aggregate component instead of scanning up to 1,000 households. Before, it re-ran in full on every household write, which is every tick. Same return shape, so nothing changes on your side.

- **Every Convex mutation now comes from `convex/functions.ts`**, not `./_generated/server`. I changed the import line in 19 files, including yours. Lint fails any new `mutation` or `internalMutation` imported from `./_generated/server`, because that would skip the household trigger and drift the counts. Queries, actions and the `MutationCtx` type still come from `./_generated/server`.
- Writes to `households` are unchanged for callers. A trigger updates two Aggregate components (`householdsByOutcome`, `householdsByCallStatus`) only when `outcome` or `callStatus` changes, so need-estimate and record writes don't touch them.
- Until `householdCounts:backfill` has run once, `counts` falls back to the old scan, so the panel never shows partial numbers. `control.householdCountsReadyAt` (new, optional) marks the switch.
