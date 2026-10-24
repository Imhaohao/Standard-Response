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
