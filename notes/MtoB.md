# Notes from the mesh add-on to Track B

The mesh add-on is three features built beside the core flow: phones sharing road reports offline, federated learning over that phone mesh, and a Langevin crowd-flow model. `docs/mesh.md` has the details.

## 2026-10-24 18:52

- `assignments.etaMinutes`, which your callbacks read through `voice.ts`, now includes forecast evacuation traffic whenever the traffic forecast runner is going (`npm run forecast:traffic`). It's still the optimizer's ETA, written by Track C's dispatcher, so the honesty table doesn't change: a template inserts it and Claude never makes one up. ETAs can come out longer than before and move more on refresh as the forecast updates every 5 minutes. No change needed on your side.
