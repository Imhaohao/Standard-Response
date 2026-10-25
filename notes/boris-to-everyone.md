# Notes from Boris to everyone

## 2026-10-24 19:55

- **No more tracks.** Nobody owns a piece of the app: whoever finds something that needs fixing fixes it. `AGENTS.md`, `PLAN.md`, `HANDOFF.md`, code comments and the call floor's stand-in hints no longer mention tracks.
- **Notes go person to person now:** `notes/<from>-to-<to>.md`, for example `notes/boris-to-brendan.md`, plus `notes/<from>-to-everyone.md` for the whole team. Read `notes/*-to-<you>.md` and `notes/*-to-everyone.md`. The letter files (`AtoB.md`, ...) are history: A was Boris, B Brendan, C Imzihao, D David.
- **Contract: `requests.party` (optional, `"patient"` or `"companions"`).** When no one vehicle can carry a whole home, `syncRequest` opens two requests. Take a bedbound patient with three family members: the ambulance seats one, so the patient's request carries the patient and one family member, and the companions' request carries the other two. Unsplit homes have no `party` and behave as before. `openRequestsFor(ctx, householdId)` returns every open request for a home. `openRequestFor` still returns one: the patient's, which is what a caller asks about. The rescue map shows the two parties as two people at the same home. The rule is `ridePartiesFor` in `convex/model.ts`, mirrored by `parties_for` in `dispatch/sim/population.py`. Tests are in `tests/workflow/rideParties.test.ts`.
- **Simulator results rerun with the split:** 64 of 65 on time (median), and the median number never picked up is now 0, not 1.

## 2026-10-25 00:35

The map can now show any of six disasters in six cities, not only the Eaton Fire. Nothing that already exists changed how it looks: `/lab` matches its old screenshots (close-up pixel-for-pixel) and every `useInkMapData()` / `setFire()` caller works unchanged.

- **City registry, `lib/cities.ts`.** One entry per city: event (name, date, hazard kind), `origin`, `detail` / `extent` / `terrain` boxes, the OSM snapshot date, named camera `frames` (an overview plus close-ups), the bake files and `sources`. Altadena is first, with today's values. The other five (`paradise`, `lower-ninth`, `fort-myers-beach`, `buffalo`, `hilo`) are drafts marked `verified: false` until their bakes check every coordinate. Hazard kinds are `wildfire`, `flood`, `surge`, `tsunami`, `blizzard`. `convex/hazards.ts` is untouched.
- **Loader.** `loadInkMapData(cityId = "altadena")` and `useInkMapData(cityId)` cache per city. Other cities bake to `public/map/cities/<id>.json` and `<id>-terrain.bin`. Terrain may carry `offsetMeters` so ground below sea level fits.
- **Scenario file v2, `public/scenarios/<city>.json`.** Types are in `lib/ink-map/scenario.ts`: `{ version: 2, city, kind, label, basis, sources, clock: { warningAt, minutesShown }, fronts, series }`. Every time is minutes after the warning; `fronts` are the arrival-time polygons every hazard has. `series` is typed per kind (`FloodSeries`, `SurgeSeries`, `TsunamiSeries`, `BlizzardSeries`, `WildfireSeries`); `sampleAt()` interpolates them. `useScenario(cityId)` reads it without Convex and returns a `Hazard` (now with optional `kind` and `scenario`) that `MapStage` takes as before. Altadena's file is the Eaton scenario converted.
- **Hazard layers, `lib/ink-map/hazard-layers/`.** A layer implements `HazardLayer` in `types.ts` and lives in its own folder. It's registered with one line in `registry.ts`, which also takes its flat-map drawing (`PaperHazard`). Layers get the G-buffer, a float texture of ground elevation, the composite's shared uniforms and a `fullscreen()` helper. They draw in four places: `drawBase` (cached with the town), `prepare`, `drawScreen` (every frame, blended over the map) and `drawScene` (their own geometry). They also report `impact(minute)`: the buildings, roads and dispatcher edges reached. Shader helpers are in `glsl.ts` (`mapPoint`, `groundElevation`, `arrivalAt`, `groundHatch`). The wildfire is the first layer (`fire/`). `flood`, `surge`, `tsunami` and `blizzard` are placeholders that hatch the arrival area. Dispose every GPU resource in `dispose()`.
- **Water is indigo.** `INK_PALETTE.indigo` / `uIndigo` in the renderer and `--map-indigo` in CSS: woodblock Prussian blue, for flood, surge and tsunami only. Snow stays ink and paper; red still means fire and people in need.
- **`/lab/scenes?city=&t=&play=1&speed=&frame=&chrome=0`.** Full-bleed city, fixed frames, scrubber. `speed` is scenario minutes per second. No Convex. `window.__scene` has `ready`, `setMinutes(m)` (resolves once drawn), `play(speed)`, `pause()`, `frames`, `setFrame(name)`, `setSeconds(s | null)` to pin the animation clock, and `impact()`. `<html data-scene-ready>` appears once the hazard has been drawn. The overview trims itself to fill a portrait 1080x1920 screen as well as a landscape 1920x1080 one.

## 2026-10-25 02:10

The water scenarios are on main as v2 files: `public/scenarios/lower-ninth.json` (flood), `fort-myers-beach.json` (surge) and `hilo.json` (tsunami). Each has a sourced `timeline.json` and a `sources.md` in `data/cities/<id>/`, listing every number's source and every assumption. Rebuild one with `uv run modeling/scripts/cities/build_water_scenario.py --city <id>`.

- **Fronts are MultiPolygons, largest part first, and some have holes (canals, high ground).** `outerRing` in `lib/ink-map/fire-field.ts` keeps only one ring per front, so the map drops the other parts and fills the holes. At Fort Myers Beach that loses San Carlos Island and the mainland edge; at Hilo, the strip of downtown bayfront if it ever separates from Waiakea. Whoever owns the water layers: please read every polygon and hole even-odd before the water scenarios go on screen.
- **Water levels are in the DEM's datum** (NAVD88; local mean sea level in Hawaii), from USGS 3DEP 1/3 arc-second, so depth = level minus ground.
- **Deadlines for the dispatch simulator** (the last section of each `sources.md`):
  - Lower Ninth: be out before the water reaches the home, and route no vans into the ward after 04:30 on 29 Aug (minute 1050).
  - Fort Myers Beach: be aboard by 20:00 on 27 Sep (minute 780), the time Lee County told everyone to be sheltered. The water's arrival is a hard limit, not a target.
  - Hilo: everyone in the evacuation zone must be out before the first wave, 00:07 (minute 212). The killer was the third wave at 01:04, and nobody could have known which wave it would be.

## 2026-10-25 01:40

The zone tool's street routing changed (lib/ink-map/street-network.ts `streetsBetweenCorners`). When the only streets between two clicked corners are more than 2.5 times the straight distance plus 200 m, the boundary now takes the straight line between them. In the foothills it used to drive down into town and back up, which cut zones in half. Zones on the town grid don't change. Saved zones keep their corners, so only a boundary that used to make one of those detours redraws.

## 2026-10-25 02:30

`npm run typecheck` fails with "Cannot find module 'playwright-core'" until you run `npm install`. The screen recorder (`npm run record`, `scripts/record/`) added `playwright-core` 1.56.1 as a dev dependency in `78111c0`, and it's in the lockfile. On the shared laptop it's already in the main checkout's `node_modules`. In a worktree, clone `node_modules` again with `cp -cR`.
