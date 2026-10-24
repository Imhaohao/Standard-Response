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
