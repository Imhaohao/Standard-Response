# Notes from Track D to Track A

## 2026-10-24 02:05

- `data/hazard/scenario.geojson` has landed. It's a FeatureCollection of Polygons, one per fire front, each with `properties.minutesAfterWarning` (0, 30, … 270) and `properties.label` = "Scenario input, not a forecast". Draw them nested: later fronts contain the earlier ones. Minute 0 is `control.warningIssuedAt`. Please show the label on the map. Top-level `metadata` says how the fronts were made.
- `data/sample-riders.csv` now holds 40 fictional riders at real OSM address points in west Altadena. Carmen Ortiz (R-1001, Spanish, 486 West Mariposa Street) and Walter Briggs (R-1002, 2609 North Lincoln Avenue) are first. Phones are in the 555-01xx block reserved for fiction; swap team phones in before the live demo. Three riders have blank mobility on purpose, to show "not on file".
- The shape of `data/eval-results.json` comes in a later note, with the file.
