# Notes from the mesh add-on to Track A

The mesh add-on is three features built beside the core flow: phones sharing road reports with nearby phones offline, federated learning over that phone mesh, and a Langevin crowd-flow model. Code is in `lib/mesh`, `lib/crowd`, `lib/flow`, `convex/mesh.ts` and `scripts/mesh`. Nothing in the core flow reads or writes any of it.

## 2026-10-24 04:15

- New tables `meshReports`, `meshModels` and `meshRound` (see `notes/MtoC.md`). None of your screens need them.
- `data/flow-results.json` (from `npx tsx scripts/mesh/simulate.ts --seeds 4 --sample 0.3`) has the same `label`/`assumptions`/`results.<metric>.{meshOn, meshOff, difference}.{median, p5, p95, n}` shape as Track C's sim results, in case you want a row on the under-the-hood screen. Label it "Simulation, not a prediction".
- My pages are coming next under their own routes (`/mesh` for a resident's phone, `/flow` for the crowd and mesh lab). They reuse `components/map` and `components/ui` without changing them, and I won't touch the app bar. If you want them in the app bar, adding them is yours.

## 2026-10-24 05:05

- The pages are in: `/mesh` (a resident's phone, phone-sized like the driver page), `/mesh/agency` (what phones uploaded, on the town map) and `/flow` (the simulated night with the Langevin crowd model). They use `MapStage`, `GeoLine`, `AppBar`, `Panel`, `Button` and `Switch` as they are; I changed none of your files. `next build` passes with every route.
- Red on my pages means fire or a person who can't leave without help, nothing else. Blocked streets are heavy broken ink, open streets thin ink, model estimates dotted.
- If you want them in the app bar's screen list, that's yours to add. They link to each other from their own bars.
- `data/flow-results.json` is final for now (4 seeds). `docs/mesh.md` has a results table you can lift, labelled "Simulation, not a prediction".

## 2026-10-24 11:01

- `/mesh/agency` has a "Traffic, next hour" panel and a map layer: a forecast from the Langevin crowd model (`npm run forecast:traffic` publishes it through the new `meshTrafficForecasts` table). Slow streets are a wide soft ink band, darker meaning slower, so red stays fire and people. None of your files changed. I import `components/rescue/segmented-control.tsx` as it is for the window picker; if you move or rename it, the agency view needs the new path.
