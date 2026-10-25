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

## 2026-10-24 13:48

**The team is moving to the Convex deployment `robust-penguin-834`.** It already has `main` pushed (schema, every function, both Aggregate components), with `SOLVER_URL` and `SOLVER_TOKEN` set to the DigitalOcean solver (health 200). It holds no data until someone issues a warning on the call floor; Reset and Issue warning seed it as usual. Replace the three Convex lines in your `.env.local` with:

```
CONVEX_DEPLOYMENT=dev:robust-penguin-834
NEXT_PUBLIC_CONVEX_URL=https://robust-penguin-834.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://robust-penguin-834.convex.site
```

Then restart `npm run dev` and anything else that read the old URL at start. Pull `main` before running `npx convex dev`, because that command pushes your local `convex/` over everyone's. `oceanic-panda-520` stops being the shared one now.

## 2026-10-24 15:42

Typecheck failed because `components/ui/app-bar.tsx` and `components/rescue/need-panel.tsx` imported `@/lib/use-sim-now`, which is not in the repo. Deadlines and the warning clock stay on the wall clock (same as the rest of the screens), so both now call `useNow` from `lib/time.ts`. No new hook.

## 2026-10-24 16:02

New data you can show (no UI was built; screens are yours):
- `reachLadder:steps({ limit? })` returns one row per in-zone household, and `reachLadder:forHousehold({ householdId })` returns one row: `{ householdId, address, simulated, callStatus, step: "first_call" | "waiting_to_retry" | "retry_due" | "retrying" | "awaiting_reply" | "reached" | "replied" | "door_check", attempt, maxAttempts, nextStep: "retry" | "door_check" | null, nextStepAt (night-clock ms) | null, source: "workflow" | "call_status" }`. That's the Convex prize's "visible workflow" moment: each rider's step and when the next one fires.
- New `events` rows of kind `retry` ("Retry 2 of 3 at …", "Texted …", "No reply: door check at …") and kind `control` ("Apify: <zone> went to warning, N riders inside").
- New optional `households.ladder` field and a new `apifyZones` table. Both are additive.

## 2026-10-24 19:01

Findings from two fire station interviews today (University Park, and Palo Alto Station 6). Both are about the neighbor ask in `convex/neighborPickups.ts` and its lines in `voice/agent/planCheck.ts`. No contract change.

- **Recruiting on the night.** University Park was against asking neighbors during the event: "now we're scrambling to find neighbors to go into a home." They said to arrange helpers ahead of time instead, so a helper knows what they're getting into. The example was a helper who hears "wheelchair" and finds a 400-lb power chair that takes four people to move. `fitsInACar` already rules out power chairs, bedbound residents and two-person lifts, and `awayFromTheFire` covers Station 6's "going backwards" point. What's left is your call: keep the live ask for walkers, manual chairs and one-person assists, or limit it to helpers on file. If it stays, keep "the ride request stays open" in every line, so a neighbor is never the only plan.
- **A stranger hears medical details.** Station 6: "you can't really ask apartment A what apartment B's medical is." Today `recruitIntro` is followed by the `needs` lines, so a recruited neighbor hears "They use oxygen." A helper the resident named can hear that. A recruited stranger should hear only what the pickup needs: room for a chair, one person to help them to the car. Suggest `needs.oxygen` only when `plan.recruited` is false.

## 2026-10-24 19:45

Apify road closures now land in `roadClosures` with `source: "apify"` (details in `CSOtoC.md`). The rescue map draws every closure regardless of source, so nothing breaks. New `events` rows of kind `control`: "Apify: road closed on Lincoln Avenue" and "Apify: Lincoln Avenue reopened". If you label closures by source anywhere, `"apify"` is the new value.

## 2026-10-24 19:55

The reach-ladder workflow is now on the call floor. The user asked for it, so I built it in your files. Change anything you like.

- New tab **No answer** (`components/floor/ladder-list.tsx`). Each home past its first miss shows its step (missed 1 of 3, ringing on a retry, texted, door check) and when the next step fires on the night clock ("Redial in 1:34", "Door check in 2:10"). Soonest next step first, door checks last. Hovering a row says whether its own Convex workflow times it or it's a simulated home on stand-in timing.
- The three counts in the reach panel's ladder are now buttons that open that tab.
- `TabButton` is `flex-auto whitespace-nowrap px-1.5` instead of `flex-1`, so four tabs fit on one line in the 23rem column. "On the phone 0" used to wrap at 82 px.
- Data: new `reachLadder:unanswered`, the same row shape as `reachLadder:steps`, read through the `by_callStatus_and_callPriority` index instead of a 1,000-household scan. Only the open tab subscribes to it.
