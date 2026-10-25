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

## 2026-10-24 18:52

At the user's request, your dispatcher now drives in the Langevin traffic forecast. With no fresh forecast it behaves exactly as before.

- **What changed in your files.** `roadGraph.ts`: `shortestPathsFrom` and `legsFor` take an optional `EdgeTime` (seconds to drive an edge entered `at` seconds after setting out; default `freeFlow`, the old `edge.seconds`), plus `edgeIndexOf(key)`. `dispatchSnapshot.ts` adds `traffic`. `dispatchWorld.ts`: `TravelTable` prices edges with it, so the solver's matrix, `forecastRun`, revocations and ETA updates all see the same times. `fleet.ts`: new road paths for simulated vans use the same times, so a van really drives slower where the ETA says it will. The forecast is read only on ticks where some van needs a new path.
- **Where the times come from.** New `convex/traffic.ts`. Each window of the newest forecast for this incident (0–15, 15–30, 30–60 min ahead) gives the median slowdown of each *direction* of each street; a street takes `1 / max(0.05, 1 − slowdown)` times longer. A van heading into the zone against the outbound queue isn't slowed by it. A forecast older than 15 minutes, or none at all (`npm run forecast:traffic` not running), means free flow.
- **Approximation, stated.** The matrix prices every leg as if it set out now (the edge times inside one leg do follow the windows). Every re-plan prices again from the present, so the leg a van is on is always priced for when it drives it.
- Nothing to deploy beyond your usual `npx convex dev`: `meshTrafficForecasts` gains two optional fields (`baseAt`, `windows[].edges`). `npm run test:mesh` covers the drive times (`lib/crowd/traffic.test.ts`), and `npm run test:workflow` passes. If you'd rather it sit behind a switch on the call floor, say so and I'll add one.

## 2026-10-24 19:20

- Correction to my 18:52 note: the dispatcher reads its drive times from a new small table, `meshDriveTimes` (per window, directed edge keys and median slowdowns, a few tens of kB), not from `meshTrafficForecasts`. Your snapshot re-reads it every re-plan, and the full forecast with its ranges is about 250 kB. `meshTrafficForecasts` gains only `baseAt` (optional). `mesh:publishTrafficForecast` writes both tables; `mesh:clear` empties both.
- **Until your next `npx convex dev`, please don't run `npm run forecast:traffic` against the shared deployment**: the deployed `mesh:publishTrafficForecast` doesn't take the new fields and refuses every forecast. Once you've deployed, the runner works again and your dispatcher starts reading traffic.
- Measured offline on the full synthetic population (4 ensemble members, the forecast fed through `convex/traffic.ts`): shelter-to-home drives into the zone barely change (median 6.1 min either way, a few up to 1.3 times longer), while home-to-shelter drives with the evacuation take a median 1.3 to 1.4 times longer (6.5 to 7.7–7.9 min), up to 1.8 times, at minutes 10 and 20 after the warning.
