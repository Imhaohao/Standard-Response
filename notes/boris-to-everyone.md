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

## 2026-10-25 01:44

The blizzard has its own renderer now (`lib/ink-map/hazard-layers/blizzard/`), replacing the hatched stand-in for Buffalo.

- **What `impact(minute)` reports for a blizzard.** `roads`: every street (classes 0 to 4) shut at that minute by `series.roadClosures`. `edges`: the dispatcher edges running along those streets. `buildings`: homes cut off, meaning the drivable edge nearest the home is shut, or it is open but no longer joined to the largest open piece of the network. A home that the map's own edge already separates from the network is never counted. In Buffalo that is nobody before minute 330, every home in the frame from 330, and from 2730 (arterials ploughed) only homes whose nearest edge is a side street.
- **Closures match by street class first.** A closure whose `road` text names a class outside brackets ("Expressways", "Arterials", "Side streets") shuts every street of that class; the bracketed street names are examples and are not matched. A closure without a class word matches street names, and one with a `path` matches the streets along it.
- **Lights follow `series.power`.** After dark each home shows a warm window, and the scenario's share of homes without power go dark in a fixed order. Without the field every light stays on.
- **Red still wins.** Roofs marked red (and charcoal "still home") are never covered by snow, fade least in the whiteout and glow through it.

## 2026-10-25 02:04

Blizzard redesign (`lib/ink-map/hazard-layers/blizzard/`): snow now reads by subtraction. As it deepens, the fine ink fades (area tints, trees, paths, minor street lines), roofs take white caps, and walls stay dark. Open streets are dark ruts and closed ones are erased, so the overview thins to a few dark lines as the town is cut off. Flakes are sparse (about 400 at the peak). The whiteout veil tops out at 25%. Night only darkens the far edge of the view. Window lights are gone, so ignore my 01:44 line about `series.power`: nothing on the map reads it now. Barriers stand only at close range, and only where a closed street meets an open one. `impact()` is unchanged.

## 2026-10-25 02:13

**The wildfire scenario is now the real Eaton Fire, not the seed-7 model.** I decided to make it the default. The seed-7 fire burned 4,196 homes that CAL FIRE's damage survey found undamaged, and its overlap with the real burn area was 0.54.

- **What it is.** Where it burned is CAL FIRE's final perimeter (`data/eaton/perimeter-eaton.geojson`). When is fitted to 342 dated fire reports in the UL FSRI timeline (`data/eaton/fire-sightings.json`), starting from the 6:18 p.m. ignition. It's capped so the map never shows fire arriving well after a nearby report: held-out reports land more than an hour later than the model only 8% of the time. Each map building burns as one piece, so a front never cuts a house. Written by `modeling/scripts/build_eaton_fire.py` into `data/hazard/scenario.geojson`, `public/scenarios/altadena.json` and `convex/scenarioFronts.ts`.
- **The clock changed.** Minute zero is **10:50 p.m.**, the first fire reported west of Lake Avenue (the same trigger as `eaton_replay.py` and `sim.eaton_night`'s `firstFireWest`). East Altadena has already burned at minute zero; its fronts run from -270. Fronts are half-hourly to 7:50 a.m., then hourly to noon (minute 780). The night is about ten hours, so play it at 30x or 60x.
- **Imzihao:** the rehearsed demo was on seed 7, so please re-rehearse. Houses reach the fire at different times now, and some on the west side never burn (the real fire stopped short of them). The judge `/you` verdicts read `fireArrivalAt`, so they follow the real fire once Convex is deployed.
- **David:** derived results on seed 7 need a rerun: `data/door-fairness.json` and anything else read from the scenario. `danger_zones.py` still starts its ensemble from the model's origin and ignition, so the forecast bands won't start where this fire is.
- **Don't overwrite it.** `spread_model.py` now writes `data/hazard/scenario-spread.geojson` by default; pass `--out data/hazard/scenario.geojson` only to put the model back on purpose. `build_hazard.py` (the old oval) is deleted.
- **Deploy:** Convex needs `npx convex dev --once` from a clean main so `fireArrival.ts` deadlines use the new fronts.
- **Restore seed 7** with `cd modeling && uv run python scripts/spread_model.py --seed 7 --out ../data/hazard/scenario.geojson && cd .. && npx tsx scripts/hazard/bake-scenarios.ts`.

## 2026-10-25 02:15

The flood, surge and tsunami have their own renderers now (`lib/ink-map/hazard-layers/water/`, shared by `flood/`, `surge/` and `tsunami/`), in place of the hatched placeholders.

- **What `impact(minutes)` reports for water:** a building once water has stood half a metre over the ground at its centre, and a road or dispatcher edge once any stretch of it is under 30 cm. Reached stays reached, as with the fire, so a tsunami's roads stay closed after the water drains. Ground outside every front never counts, even late in the night.
- **Depth is level minus ground.** The level is `series.water.level`, and near an open breach it slopes down from the canal's gauge to the basin over a few hundred metres. A tsunami's level comes from `waves` and `approachFromDegrees`. Each crest is timed at the bayfront in front of the flooded town, crosses the water at 10 m/s and runs inland at 4 m/s.
- **New `event` frames** in `lib/cities.ts`, about 2 km across, for the Lower Ninth (the north breach and the ward), Fort Myers Beach (Estero Island's north end with Times Square and the pier) and Hilo (downtown and Waiākea). `/lab/scenes?city=<id>&frame=event`. A scenario that starts more than an hour after its warning opens half an hour before its first front.
- **GPU cost:** one fullscreen pass and no render targets. It adds a shore texture (2 bytes a cell, at most 1024 across) and the arrival field as half floats.
- **Tests:** `npx tsx --test lib/ink-map/hazard-layers/water/water.test.ts`. It isn't in `npm run test:map`, whose glob only covers `lib/ink-map/*.test.ts`. Widening it would also pick up the blizzard's tests, one of which was failing at 01:30.
