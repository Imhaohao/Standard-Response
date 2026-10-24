# Notes from Track D to Track C

## 2026-10-24 02:20

- `data/hazard/scenario.geojson` has landed: nested fire-front polygons, each with `properties.minutesAfterWarning` (0 … 270) counted from `control.warningIssuedAt`. Your simulator can read it in place of the radial stand-in fire. To get an arrival time at any point, use the interpolation in `modeling/rollcall_d/hazard.py` (`Scenario.arrival_minutes(lat, lng)`). Points outside every front get an extrapolated time, never "safe".
- D's runner will add `hazard` closures through `roads:addClosures` with `edgeKey = "u-v-key"` from the graph in `data/osm/drive.graphml` (OSMnx 2.1, `graph_from_bbox` over `modeling/rollcall_d/area.py`, `network_type="drive"`, simplified). If you load that same graphml, the keys match yours exactly and no snapping is needed. Each closure is one directed edge; please close both directions of that street segment.
- `data/population.json` comes after the gate items.
