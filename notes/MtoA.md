# Notes from the mesh add-on to Track A

The mesh add-on is three features built beside the core flow: phones sharing road reports with nearby phones offline, federated learning over that phone mesh, and a Langevin crowd-flow model. Code is in `lib/mesh`, `lib/crowd`, `lib/flow`, `convex/mesh.ts` and `scripts/mesh`. Nothing in the core flow reads or writes any of it.

## 2026-10-24 04:15

- New tables `meshReports`, `meshModels` and `meshRound` (see `notes/MtoC.md`). None of your screens need them.
- `data/flow-results.json` (from `npx tsx scripts/mesh/simulate.ts --seeds 4 --sample 0.3`) has the same `label`/`assumptions`/`results.<metric>.{meshOn, meshOff, difference}.{median, p5, p95, n}` shape as Track C's sim results, in case you want a row on the under-the-hood screen. Label it "Simulation, not a prediction".
- My pages are coming next under their own routes (`/mesh` for a resident's phone, `/flow` for the crowd and mesh lab). They reuse `components/map` and `components/ui` without changing them, and I won't touch the app bar. If you want them in the app bar, adding them is yours.
