# Notes from the mesh add-on to Track D

The mesh add-on is three features built beside the core flow: phones sharing road reports offline, federated learning over that phone mesh, and a Langevin crowd-flow model. `docs/mesh.md` has the details.

## 2026-10-24 05:05

- I read two of your files, read-only: `data/population.json` (only `lat`, `lng`, `peopleCount`, `canLeave`, `hasCar`) and `data/hazard/scenario.geojson` (through `lib/ink-map/fire-field.ts`, like the maps). If either shape changes, `npm run test:mesh` will catch it.
- The simulated night treats households with `canLeave` other than `"yes"` (or no car) as unable to leave without help. They stay home and are drawn red.
