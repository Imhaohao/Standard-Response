# Notes from Track D to Track A

## 2026-10-24 02:05

- `data/hazard/scenario.geojson` has landed. It's a FeatureCollection of Polygons, one per fire front, each with `properties.minutesAfterWarning` (0, 30, … 270) and `properties.label` = "Scenario input, not a forecast". Draw them nested: later fronts contain the earlier ones. Minute 0 is `control.warningIssuedAt`. Please show the label on the map. Top-level `metadata` says how the fronts were made.
- `data/sample-riders.csv` now holds 40 fictional riders at real OSM address points in west Altadena. Carmen Ortiz (R-1001, Spanish, 486 West Mariposa Street) and Walter Briggs (R-1002, 2609 North Lincoln Avenue) are first. Phones are in the 555-01xx block reserved for fiction; swap team phones in before the live demo. Three riders have blank mobility on purpose, to show "not on file".
- The shape of `data/eval-results.json` comes in a later note, with the file.

## 2026-10-24 02:20

Contract additions (new things only; nothing you use has changed):

- New D-owned singleton table `modelState`. `estimates:state` returns `{ smoothing, doorAlpha?, lastRunAt?, stats? }`. Please put an on-screen toggle bound to `estimates:setSmoothing({ enabled })`. It's the "spatial smoothing from answered neighbors" switch in the plan; the runner applies it on its next pass (every ~5 s). `lastRunAt` tells you whether the real need model is running, and `stats` holds counts from the last pass (`estimated`, `doorScored`, `closuresAdded`, `nominationsMatched`, `nominationsFlagged`, `located`).
- `nominations` rows gain an optional `note`. `nominations:open` is unchanged (still awaiting a match). New `nominations:flagged` returns nominations D couldn't place, with `note` saying why ("no house number", "two streets match", ...). They need the dispatcher, so please list them with the open ones.
- `nominations:matchAddress` (D only) can add a household for a nominated address that isn't on the rider list. It has `callbackNumber: ""` and `callStatus: "door_check"`, so it appears in `doorChecks:queue` and never in the dial queue.

## 2026-10-24 03:20

`data/eval-results.json` has landed. Shape (all accuracies 0–1, `ci95` is a 95% Wilson interval):

```
{ label, generatedAt, agent, caveat?,            // show `label` always; show `caveat` big if present
  personas, completed, errors: [{persona, error}],
  fields: { address|peopleCount|mobility|assistanceRequired|canLeave|oxygen: { correct, total, accuracy, ci95 } },
  allFieldsCorrect: { correct, total, accuracy, ci95 },
  byLanguage: { en: {<field>: accuracy}, es: {...} },
  byTrait: { hard_of_hearing: { cards, allFieldsCorrect }, ... },
  corrections: { correct, total, accuracy, ci95, byWhen: { next_turn|readback|second_voice: {correct,total,accuracy,ci95} } },
  escalations: { expected, raised }, nominations: { expected, captured },
  completion: { turnsMedian, turnsP95, secondsMedian, secondsP95 },
  latency: { turnMsP50, turnMsP95 },  guardBlocked,
  failures: [{ persona, field, expected, got, traits }] }
```

The file in the repo now comes from my scripted stand-in agent, so it carries a `caveat`: its 100% only proves the harness. It gets replaced by the run against Track B's real endpoint. The four plan fields are `address`, `peopleCount`, `mobility` and `assistanceRequired`; please lead with those, then corrections.

## 2026-10-24 03:50

- `data/honesty-results.json` has landed (the implied-reassurance grader). Shape: `{ label, generatedAt, grader, linesGraded, lexical: {flagged, graded, rate, ci95}, model: same | null, bySource: {<source>: {lexical, model}}, byStatus: {received|reassigning|approved|none: rate | null}, humanSpotCheck: {labeled, agreement} | null, flaggedExamples: [{source, status, text, quote}] }`. Show `label`, then `model.rate` with its `ci95` (or `lexical` when `model` is null, and say "lexical only"). This is the "two honesty numbers" item. The time-to-callback numbers come from `callbacks` timestamps, which you already have.
- New read-only query `estimates:agentLines({ limit })`: agent transcript lines with `requestStatus`. The grader uses it with `--convex`.

## 2026-10-24 04:30

- `data/population.json` (11,855 synthetic households) and `data/population-meta.json` have landed. If the under-the-hood screen mentions the simulator's ground truth, use the meta `label`: "Real ACS PUMS household records reweighted to real block-group and tract totals; not real people."
- `data/eval-results.json` was regenerated against population-based personas (still the scripted stand-in, still with `caveat`).

## 2026-10-24 05:10

`data/door-fairness.json` has landed (door-check fairness tests, post-gate item 1). Shape: `{ label, setup, metrics: {name: description}, ranges, results: { <scenario>: { score|score_no_aging|nearest|random: { worstWait|p95Wait|meanWait|needyInTime|isolatedWorst?|slowAreaWorst?: {mean, p5, p95} } } }, headlines: [string] }`. `headlines` are sentences computed from the numbers, ready for the under-the-hood screen. Show the range (p5–p95) next to every mean and keep `label` visible ("simulated; a policy test, not a forecast"). The honest read: our order checks far more truly needy homes before their deadline than nearest-first (89% vs 68% at baseline), with a worst-case wait within about 3% of nearest-first. With 6 teams and 400 homes, capacity sets the worst case.

## 2026-10-24 05:40

- `data/hazard/scenario-spread.geojson` has landed: the spread model's scenario (post-gate item 2), in exactly the same format as `scenario.geojson`. It comes from fast marching with wind-driven elliptical spread and seeded spot fires, so later fronts can be MultiPolygons. If you add a scenario picker, label it "Spread model (scenario input, not a forecast)" and show `metadata.claim`: "Conservative within our assumptions. Not validated against satellite data." The runner switches with `--scenario data/hazard/scenario-spread.geojson`.

## 2026-10-24 06:30

- Thanks for typing `estimates:state` and splitting `inputs`. Both work with the runner (it reads `incidentKey` from `inputs.state`, which is still the full row).
- Rows worth showing from `stats`, in this order: `scenarioMinute` ("Scenario minute"), `closuresAdded` ("Hazard closures, last pass"), `doorScored` ("Door checks re-scored"), `nominationsMatched` / `nominationsFlagged` ("Neighbor reports placed / need a dispatcher"), `located` ("Inbound callers located"). `estimated` is noisy; skip it. If `lastRunAt` is more than 15 s old, show "Need model: stand-in or stopped".

## 2026-10-24 07:00

- `data/eval-results.json` is now the real run against Track B's live agent (no `caveat` any more). Headline fields: address 0.97, people 1.00, mobility 0.97, assistance 1.00; corrections 100%; turn latency p50 1.26 s / p95 1.89 s. Show each with its `ci95`.
- `data/honesty-results.json` now has the Claude grader on every source: red-team set 0/421, live calls 0/9, persona eval 9/1611 (lines that slipped past the guard; reported to B). Show `bySource`, not only the total, so the red-team 0 and the persona-eval misses are both visible.

## 2026-10-24 07:05

- `rider.mobility` and `rider.medical` are the household record fields that calls fill in (Track B's, the same as `households:update`), not model estimates. Keying the door warnings off them is right: `medical` includes `"oxygen"` → oxygen warning; `mobility === "bedbound"` or `assistanceRequired === "two_person_lift"` → lift warning. The only model numbers are `needProbability` and `doorPriority`, and neither should appear on the driver page.

## 2026-10-24 07:45

- `data/eval-results.json` is updated: the live agent after Track B's fixes, 197/200 cards with every field right (98.5%). `data/honesty-results.json` now has two sources (red-team 0/421, persona eval 2/1,629). Live calls come back once the fixed `estimates:agentLines`, which excludes simulated stand-in calls, is deployed.
- FYI, if you show the call floor to judges with the voice stand-in on: its closing line "We are arranging a vehicle and will call you back with the driver's name" (`convex/scripts.ts`) implies help is coming. It's stand-in text, but a judge reading the transcript won't know that.

## 2026-10-24 03:43

`data/alignment-results.json` has landed (the sponsor lead's alignment evals; one row each on the under-the-hood screen, all labeled simulated residents). Shape:

```
{ label, generatedAt, agent, grader, seconds, caveat?,
  evals: [
    { key: "pressure" | "injection", name, description, cards, calls,
      passed, total, rate, ci95,                       // the row: pass rate with its 95% Wilson interval
      failuresByReason: { impliedPromise?, statusLineSkipped?, noSafetyLine?, fieldChanged?, unknownField?, escalated?, promptSpoken?, otherRiderData? },
      impliedReassurance: { flagged, graded, rate, ci95 },
      worstExample: { card, status, language, reason, detail } | null,   // detail.text / detail.quote for an implied promise
      byDetail | byStatus | byLanguage: { <name>: { passed, total, rate, ci95 } }, errors },
    { key: "spanishParity", name, description, byLanguage: { en|es: { allFieldsCorrect, corrections, escalations, turnMsP50, turnMsP95, impliedReassuranceRate, honestyLineShare, pressurePass, injectionPass } }, gaps: { <metric>: es - en }, missing: [metric], note },
    { key: "graderHuman", name, description, humanSpotCheck: { labeled, agreement } | null, status } ] }
```

Show `name`, `rate` with `ci95`, and the worst example's `detail.text` for each of the first two rows. Current run: pressure 48/64 (bargaining callers are the gap, sent to Track B), injection 39/40. For parity, show a two-column table and leave any metric in `missing` blank; those fill in on the next persona-eval and honesty rerun. Also new and additive: `byLanguageOutcomes` in `data/eval-results.json` and `byLanguage` in `data/honesty-results.json`. Every existing key is unchanged.

## 2026-10-24 04:08

`data/alignment-results.json` gains a third row, `key: "barrier"` ("Language and speech barrier"), in the same shape as `pressure` and `injection`, plus a `baseline` string while it measures the agent from before the hand-off was deployed. Please show that string under the row. The parity row gains `barrierPass` and now has real persona-eval numbers: all fields en 99.2% / es 98.6%, corrections 100% / 100%, escalations 100% / 100%, turn p50 1.22 s / 1.20 s. The honesty-by-language cells fill in when the Track D grader rerun lands.

## 2026-10-24 08:30

New and updated Track D results, all additive:
- `data/eval-results.json`: live agent, 198/200 cards all fields right (99.0%, CI 96.4–99.7%). New key `byLanguageOutcomes: { en|es: { cards, allFieldsCorrect, corrections, escalations, latency } }` for the parity row.
- `data/honesty-results.json`: each line is now graded 3 times by the Claude grader and counts on a majority (single runs weren't stable). Each verdict carries `votes` ("2/3"). New key `byLanguage: { en|es: { lineShare, lexical, model } }`. `humanSpotCheck` becomes `{ graderVsHumanA, graderVsHumanB, humanAVsHumanB: {labeled, agreement, kappa}, graderFalsePositives, disagreements }` once two people label `data/honesty-spot-check.csv` (columns `human_a`, `human_b`). Until then it's null; show "awaiting human labels".
- New `data/need-model-results.json`: `{ label, setup, censusPriorOnly, smoothingSweep[], chosen, withNominations, readingTheResult, headlines[] }`, each metric as `{mean, p5, p95}`. Show `headlines` and `readingTheResult`. It's an honest result: on synthetic households, smoothing doesn't beat the census prior (AUC 0.62 vs 0.64), and the file says why.
- `data/door-fairness.json` gains `alphaSensitivity: { "15 min"|"30 min"|"60 min"|"120 min": { worstWait, needyInTime, chosen }, reading }`.

## 2026-10-24 11:30

New, additive: `data/hazard/danger-zones.geojson` from `modeling/scripts/danger_zones.py`, served at `GET /api/danger` (null when the file is missing). Features are `{ probability: 0.1|0.5|0.9, minutesAfterWarning: 0..270 step 10 }` with Polygon or MultiPolygon geometry; the area is burned by that minute in at least that share of 100 spread-model runs under the NWS wind forecast. `metadata.wind` is `{ source: "nws"|"scenario", note?, fetched?, now?: { speedKmh, fromDegrees, gustKmh } }`. The rescue map draws it through `useDangerZones` + `DangerLayer` with a show/hide control above the scrubber. `/api/scenario` now shares `lib/hazard-file.ts` and is otherwise unchanged; deadlines and closures still use the scenario only.

## 2026-10-24 19:20

Fast playback made the need-model runner look dead. `estimates:reportRun` stamped `lastRunAt` with `simNow`, and the 15 s staleness check compared it on the night's clock. At 10× a 5 s runner pass is 50 s of night, so `convex/sim.ts` ran the stand-in need model between real passes and overwrote the runner's estimates.

- New additive field: `modelState.lastRunWallAt` (wall clock), also returned by `estimates:state`. `needModelRunnerLive(ctx)` now uses it and takes no `now`. I changed its one caller in `convex/sim.ts`.
- `lastRunAt` is unchanged and still on the night's clock.
- For you: the plan panel's "Last pass … ago / Stand-in or stopped" hint (`components/rescue/plan-panel.tsx` `ModelState`) has the same problem at 10× and above. Comparing `lastRunWallAt` against `Date.now()` there fixes it.
- Not deployed yet. The fix reaches `robust-penguin-834` with the next `npx convex dev` push from `main`.

## 2026-10-24 19:45

Two Track D changes in `estimates:inputs`, both additive:

- It returns `hazard`, and `run_models.py` follows it: the earthquake pick uses `scenario-earthquake.geojson`, and flood or hurricane (no file yet) get no deadlines or closures from Track D. `--scenario` still pins one file.
- Each household row carries `priorKnown`, and `needPriorKnown(h)` is exported from `convex/estimates.ts`. Neighbor smoothing no longer touches a home with a Ready check profile or a mobility need on file, in the runner and in the stand-in (`convex/sim.ts`). Before, a known two-person lift surrounded by neighbors who could leave dropped from 0.9 toward 0.45. The "Guess need from neighbors' answers" switch now only moves base-rate homes.

## 2026-10-24 20:05

I checked the Eaton replay's `needs_ride` against `outcomeFor`, as you asked. They disagreed on one case: a walker user who can leave and has a car. `outcomeFor` and Track C's `outcome_of` call that `leaving`, but the replay counted it as needing a ride. That's 339 of the 1,601 synthetic households it counted, and 1,262 is the right total. I fixed `needs_ride` in `rollcall_d/eaton_replay.py` and added a test. Nothing else in your files changed.

**`data/eaton/replay-results.json` is now stale.** The fleet check's denominator shrinks, so the "50 vans move 97%" figure should go up. I didn't regenerate it: the FSRI CSV is git-ignored and I'd have to download it. Please rerun `uv run python scripts/eaton_replay.py` where you have the CSV, and update any slide or README line that quotes the fleet numbers. The documented-request rows don't use `needs_ride`, so the 11-of-16 and 14-of-14 results stay the same.


## 2026-10-24 17:39

Neighbor calls: what one call hears now decides which neighbors 911 calls next (`convex/neighborCalls.ts`).

- A home that can't get out, with no driver close by, moves up to 3 uncalled homes around it that may have a car (no `hasCar: false`, no Ready check "needs a ride" or "helper") to the front of `nextToCall`. A Ready check "own car" goes first, then nearest. When the search circle widens, homes in the wider circle are added.
- A neighbor driving out with nobody close by waiting moves up to 3 uncalled homes within 900 m that likely need a ride (Ready check "needs a ride", or `needProbability >= 0.4`, and nothing on record a car can't carry) to the front.
- When one of those calls hears the missing half, the existing neighbor ask creates the `checking` pickup plan, so nothing new is needed on the call side.
- New table `neighborCalls` (cleared on reset). `startCall` removes a home's row. A row is dropped from the queue once its home has a helper on the way, or once its driver is busy.
- `nextToCall` order is now: neighbor calls, then Claude's plan, then `callPriority`. `households:queue` returns the neighbor reason in `planReason` when there is one.
- The shared car and ride rules (`canDrive`, `fitsInACar`, `busyHelpers`, ...) moved from `neighborPickups.ts` to `neighborRules.ts`.

## 2026-10-24 18:20

Real households were never called after the warning. Two fixes in `control:issueWarning`:

- `coverAreaIfNoZone` (`convex/riders.ts`): if no zone has been drawn, the warning now covers every household (`inZone: true`), the same as the seeded town. Homes that signed up at `/ready` or came from the CSV used to stay `inZone: false`, so the dialer and the pickup check skipped them. A drawn zone still decides as before.
- `retimeArea` (`convex/seed.ts`, was `retimeSimulatedArea`): every located household, real or simulated, gets its `fireArrivalAt` from the stand-in fire when the warning goes out. Before, a real home kept the "+90 min from sign-up" placeholder, so the neighbor who signed up second always looked upwind to `awayFromTheFire` and was never asked. Track D's runner still overwrites these through `households:setEstimates`.

## 2026-10-24 18:45

Pickups are now confirmed by both sides, and each side hears an update when something changes (`convex/pickups.ts`). `pickupStatus` is unchanged; only fields and reasons were added to `pickupPlans`:

- `residentConfirmedAt`, `confirmAttempts`: after the helper says yes (`coming`), the resident is called and asked whether they'll go with them.
- `helperNotice` (`resident_ready` | `called_off`) and `residentNotice` (`helper_cancelled`), each with an attempts count: a status update still owed to one side. A `fell_through` plan can still owe the helper a "called off" call.
- New `reason` values: `resident_declined`, `needs_changed` (a later call says a car can't take them), `not_needed` (a later call says they can drive out). I added labels for them to `REASON` in `components/rescue/ready-panel.tsx`; change the wording if you like.
- `households:update` now calls `reviewPickups`: a recruited neighbor's pickup ends when the resident can leave on their own or needs more than a car, and any live pickup ends when its helper's own call says they can't drive.
- The stand-in confirms simulated residents and gives simulated notices on the spot, so the map shows the same steps.
