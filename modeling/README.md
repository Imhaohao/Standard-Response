# Track D: modeling and evaluation

Python 3.12 with [uv](https://docs.astral.sh/uv/). Every script reads and writes under `data/`, and every service talks only to Convex.

```bash
cd modeling
uv sync
uv run pytest -q
```

## Live models (run during a session)

```bash
uv run python scripts/run_models.py                    # every 5 s against CONVEX_URL or the repo's .env.local
uv run python scripts/run_models.py --time-scale 10    # a 4-hour night in 24 minutes
uv run python scripts/run_models.py --scenario ../data/hazard/scenario-spread.geojson
```

Each pass reads `estimates:inputs` once and writes only what changed:

| Model | Writes | The number that has to survive "how did you set that?" |
| --- | --- | --- |
| Hazard deadlines | `households:setEstimates` (`fireArrivalAt`) | Arrival interpolated between labeled fronts. Outside every front: extrapolated, never "safe" |
| Hazard closures | `roads:addClosures` (`source: "hazard"`, OSM `edgeKey`) | A road closes when a front is within 150 m, about 6 minutes of head-fire spread |
| Need estimate | `households:setEstimates` (`needProbability`) | Census prior; nomination likelihood ratio 8; smoothing kernel 250 m, prior strength 3 (on-screen toggle `estimates:setSmoothing`) |
| Door-check order | `doorChecks:setPriorities` | `p·u/τ + α·wait`. α is set once per incident so 30 minutes waiting equals the 90th-percentile need-and-urgency term |
| Address matching | `households:setLocation`, `nominations:resolve`, `nominations:matchAddress` | House number and street must both agree (English and Spanish spoken numbers); anything weaker is flagged with a reason |

On start the runner switches off the "Need model" stand-in, Track D's own switch. The models never read `personas`.

## Data builders (run once; outputs are committed)

| Script | Output |
| --- | --- |
| `fetch_osm.py` | `data/osm/`: address points, residential buildings, care facilities, drive graph |
| `build_hazard.py` | `data/hazard/scenario.geojson`: elliptical wind-driven fronts shaped after the Eaton Fire's path into west Altadena |
| `spread_model.py` | `data/hazard/scenario-spread.geojson`: fast-marching spread with spot fires (scikit-fmm) |
| `build_riders.py` | `data/sample-riders.csv`: 40 fictional riders at real addresses, Carmen and Walter first |
| `fetch_census.py` | `data/census/`: block-group and tract ACS controls, PUMS households (bulk files, no API key) |
| `build_population.py` | `data/population.json`, `data/census/base_rates.json`: PUMS records IPF-reweighted to block groups and tracts |
| `build_personas.py` | `data/personas.json`: 200 cards with truth, traits and corrections |

## Evaluation

```bash
uv run python scripts/eval_personas.py --endpoint http://localhost:8787            # Track B's POST /turn
uv run python scripts/eval_personas.py --endpoint http://localhost:8787 --honesty  # red-team set: 25 callers x received/reassigning
uv run python scripts/grade_honesty.py --convex                                    # implied-reassurance grader
uv run python scripts/door_fairness.py                                             # door-check orderings under stress
```

- Without `--endpoint`, the eval runs a scripted stand-in agent. Its score only proves the harness works, and the results file says so.
- The honesty grader uses `claude-opus-5-5` (low effort, structured output, server-side fallbacks on), with the SDK's normal credential lookup. With no credentials it runs only the lexical floor, and the results file says so. It writes `data/honesty-spot-check.csv`: fill in the `human` column (yes/no) and re-run to get grader–human agreement.

## What we claim, and what we don't

- The hazard scenario is scenario input, not a forecast. The spread model is "conservative within our assumptions", never "validated against satellite data".
- The population is real census records reweighted to real totals, not real people. ACS has no wheelchair, bed or oxygen variables; that mapping is a stated assumption (`rollcall_d/population.py`).
- The door-check score only orders visits. Nobody is skipped because of it, and no individual score is shown.
