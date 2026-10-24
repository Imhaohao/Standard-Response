# Notes from Track A to Track D

## 2026-10-24 01:47

- `riders:importCsv` now skips rows whose phone number is already on file, so re-uploading the sample is safe.
- `/system` reads `data/eval-results.json` through `/api/results` and shows the raw JSON until you tell me the shape.
- The rescue map still draws the stand-in radial fire. Tell me when `data/hazard/scenario.geojson` lands and I'll draw it.

## 2026-10-24 06:05

- I changed `estimates:state` in `convex/estimates.ts`, which is your file. It now has an explicit `returns` validator and returns the four fields your note documents: `{ smoothing, doorAlpha, lastRunAt, stats }`. Before this it was typed as `{ smoothing: boolean }`, so `lastRunAt` and `stats` were unreachable from the client and the plan panel could not tell whether your runner was alive. Nothing about what is stored changed.
- The `inputs` handler was refactored into named helpers (`toHouseholdInput`, `toNominationInput`, `toClosureInput`, `matchedHouseholdIds`, `zoneInput`) to get under the complexity hook. Same output as before.
- The plan panel now reads `estimates:state` and shows a "Neighbour smoothing" switch bound to `estimates:setSmoothing({ enabled })`, with `lastRunAt` as the hint line. `stats` is not shown yet; tell me which counts are worth a row.
- The rescue map draws your `data/hazard/scenario.geojson` fronts. The nested burn polygons are translucent red and the next front is a dashed red line. Your `label` ("Scenario input, not a forecast") is on the fire scrubber, which moves `minutesAfterWarning` from 0 to the last front.
- `nominations:flagged` is listed above `nominations:open` in the same panel, with your `note` in red. `nominations:matchAddress` needs nothing from me.

## 2026-10-24 07:40

- Additive change to `convex/offers.ts` `withContext`, which feeds both `offers:forVehicle` and `offers:active`: the row now also carries `needsLift` and `deadlineAt` from the request, and a `rider` object built from the household (`residentName`, `language`, `peopleCount`, `mobility`, `assistanceRequired`, `medical`, `pets`). Nothing was removed or renamed, so anything reading `offers:active` sees every field it saw before.
- The driver page reads `rider.medical` and `rider.mobility` to decide which door warnings to show (oxygen, two-person lift, bedbound). If those fields mean something narrower to your model than they look like, say so and I will key off the request instead.
- The plan panel now shows all six of your stat rows, in your order, above the smoothing switch. `lastRunAt` older than 15 s reads as "Stand-in or stopped".
