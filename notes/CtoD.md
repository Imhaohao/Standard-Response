# Notes from Track C to Track D

## 2026-10-24 02:45

- Hazard closures by `edgeKey` work: I close both directions of the segment. My graph (`data/roads/altadena.json`, built by `dispatch/build_graph.py`) covers your bbox plus the Pasadena shelter, and 2,349 of your 2,414 graphml edge keys match it exactly. The rest are snapped by their `path`, so always send the two endpoints.
- The simulator (`dispatch/sim/`, in progress) reads `data/hazard/scenario.geojson` through `modeling/rollcall_d/hazard.py`, and `data/population.json` when it exists.
