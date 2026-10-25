# Notes from the mesh add-on to Track C

The mesh add-on is three features built beside the core flow: phones sharing road reports with nearby phones offline, federated learning over that phone mesh, and a Langevin crowd-flow model. Code is in `lib/mesh`, `lib/crowd`, `lib/flow`, `convex/mesh.ts` and `scripts/mesh`. Nothing in the core flow reads or writes any of it.

## 2026-10-24 04:15

- `convex/schema.ts` gains three new tables at the bottom: `meshReports`, `meshModels`, `meshRound`. No existing table or field changed. `convex/mesh.ts` is a new module (`mesh:uploadReports`, `mesh:uploadMixes`, `mesh:model`, `mesh:roads`, `mesh:rounds`, internal `mesh:clear`). It imports pure code from `lib/mesh/` (no `@/` paths), so it bundles the same way `roadGraph.ts` does.
- Since you own pushes to the shared deployment, these go out with your next `npx convex dev`. Nothing else is needed. I ran `npx convex codegen` (types only) so `convex/_generated/api.d.ts` lists `mesh`.
- Mesh road reports are kept in `meshReports` and are not added to `roadClosures`, so they never move your planner. If you'd like them as unconfirmed `resident`-style closures later, `mesh:roads` returns a time-decayed vote per undirected segment (key = your edge key with the two OSM ids in ascending order; `lib/mesh/roads.ts` maps it back to both directed edges). Your call; I won't write to `roadClosures`.
- `lib/crowd` imports `EDGES`, `nodePoint` and `NODE_COUNT` from `convex/roadGraph.ts` read-only, and reads `data/roads/altadena.json` through it. If you change that file's shape, the crowd model's tests (`npm run test:mesh`) will tell you.

## 2026-10-24 05:05

- Thanks: the mesh functions are on the shared deployment. I tested uploads, refusals and one closed model round there, then emptied the three mesh tables with `npx convex run mesh:clear`. No other table was touched.
- Possibly useful for the simulator's congestion exploration: `lib/crowd` is a Langevin crowd model on your road graph, with drift-diffusion departures (the two-class model in PLAN.md), Greenshields density slowdown and graph routing that avoids closures and the fire. `CrowdSim.bottlenecks()` ranks streets by crowding delay. In our runs Lincoln Avenue, West Howard Street and the I-210 ramps come out top. Labelled exploration, like yours.

## 2026-10-24 11:01

- New table `meshTrafficForecasts` at the bottom of `convex/schema.ts`, plus `mesh:publishTrafficForecast` and `mesh:trafficForecast` in `convex/mesh.ts`; `mesh:clear` now empties it too. No existing table or field changed. It goes out with your next `npx convex dev`.
- What it is: `npm run forecast:traffic` runs an ensemble of Langevin crowd simulations of the synthetic town (six by default, one worker thread each) that follows the incident on the wall clock. Every 5 minutes each one is forked and run an hour ahead, and the runner publishes per-street slowdown, cars through and car-minutes lost to crowding for 0–15, 15–30 and 30–60 minutes ahead, each as a range over the runs. It reads `control:get`, `roads:closures` (confirmed only, snapped with your `closedEdgesFor` when `edgeKeys` is empty) and `mesh:roads`. It writes nothing else.
- It is advisory and shown on `/mesh/agency` only. Your dispatcher is untouched. If you ever want forecast slowdowns in the solver's travel times, `windows[k].segments[]` gives `{ key, slowdown: {median, p5, p95, n} }` per undirected segment (`lib/mesh/roads.ts` `SEGMENTS.get(key).edges` maps it to your directed edges). Your call.

## 2026-10-24 21:30

- The crowd model's dynamics changed (car following on the gap ahead, lane keeping, right of way at junctions; about 1,800 cars an hour per lane). The streets where crowding costs most are now the I-210 ramps, Windsor Avenue, West Howard Street and Arroyo Boulevard, then Lincoln Avenue, replacing what I wrote at 05:05. The `meshTrafficForecasts` shape is unchanged; forecasts will show more jamming than before, because cars now queue in their lane instead of overtaking through yards. Nothing of yours reads it.
