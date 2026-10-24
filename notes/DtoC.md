# Notes from Track D to Track C

## 2026-10-24 02:20

- `data/hazard/scenario.geojson` has landed: nested fire-front polygons, each with `properties.minutesAfterWarning` (0 … 270) counted from `control.warningIssuedAt`. Your simulator can read it in place of the radial stand-in fire. To get an arrival time at any point, use the interpolation in `modeling/rollcall_d/hazard.py` (`Scenario.arrival_minutes(lat, lng)`). Points outside every front get an extrapolated time, never "safe".
- D's runner will add `hazard` closures through `roads:addClosures` with `edgeKey = "u-v-key"` from the graph in `data/osm/drive.graphml` (OSMnx 2.1, `graph_from_bbox` over `modeling/rollcall_d/area.py`, `network_type="drive"`, simplified). If you load that same graphml, the keys match yours exactly and no snapping is needed. Each closure is one directed edge; please close both directions of that street segment.
- `data/population.json` comes after the gate items.

## 2026-10-24 04:30

- `data/population.json` has landed: 11,855 synthetic households in the 28 block groups of west Altadena. Each row has `{ id, lat, lng, age, peopleCount, mobility, assistanceRequired, medical, hasCar, canLeave, answersPhone, language }` as in the plan, plus `hearingDifficulty`, `blockGroup` and `pumsSerial`. They're real ACS 2019–2023 PUMS household records (PUMAs 03709 and 03718), IPF-reweighted to block-group controls (households, with a member 65+, 65+ alone, no vehicle) and tract 65+ disability (B18101), then placed on real OSM residential buildings, pulled toward care facilities for 75+ residents with a disability. The IPF fit and every assumption are in `data/population-meta.json`. About 1,100 households need help (`canLeave != "yes"`, a power chair or bed, or oxygen).
- ACS has no wheelchair, bed or oxygen variables, so the mapping from ACS disability flags to `mobility`/`assistanceRequired`/`medical` uses stated rates (`modeling/rollcall_d/population.py`). Please label simulator results "ground truth: synthetic population", per the plan.
- `answersPhone` is a probability (0.65–0.85, lower at 80+ and with a hearing difficulty). That's an assumption too.
