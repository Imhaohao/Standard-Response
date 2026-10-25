# Picking up Boris's work

You are working on the interface of a hackathon app. Boris built the map and the rescue map. On
Saturday 24 Oct around 03:30–04:00 Brendan's Claude finished the rest of the interface from this file: the
driver page, the call floor, `/system` and `/phone` are all on the new design now. Read "What is
done" before you change any of them, so you build on that work instead of redoing it.

## The one thing to get right

Every screen is a **black-ink-on-paper map of Altadena, drawn in 3D**, and everything the app has
to say is said *on that map*. Panels float over it. There is almost no page copy. If you find
yourself writing a sentence that explains the interface, delete it and find a way to draw the fact
instead.

The reference is Dokodemo Rokehan (`tools.oyasumi-gamedev.com/rokehan`) — a hand-drawn Japanese map
that looks like a woodblock print with depth. It is proprietary; we rebuilt the look from scratch
on three.js (MIT). Do not copy their assets.

Non-negotiable direction:

- **Light mode only.** Paper and ink. No dark theme on the map itself.
- **Red is the only hue.** It means fire and it means a person who needs help. Nothing else is
  coloured. Every other distinction is tone, weight or hatching.
- **The camera does not move.** Fixed framings, no fly-tos, no panning to follow a vehicle.
- **Two surfaces, one stage.** `mode="ink"` is the 3D renderer; `mode="paper"` is the flat SVG
  version for a slow machine or a reader who wants no depth. Both draw the same data and both must
  look finished. The toggle is on the rescue map toolbar.
- **Non-technical readers.** The bar is Facebook or Supabase: a person who has never dispatched
  anything should understand the screen without being taught it.

## Read these before you write code

1. `AGENTS.md` at the repo root, and `~/.claude/CLAUDE.md`. They are long and they are the law.
   The typography, layout and writing rules in there are why the existing screens look the way they
   do. `better-interface` and the other `better-*` skills are subordinate to those files.
2. `PLAN.md`, the section for the screen you are building.
3. The notes addressed to Boris: `notes/*-to-boris.md`, `notes/*-to-everyone.md`, and the older
   `notes/*toA.md` (A was Boris).
4. Every note Boris wrote: `notes/boris-to-*.md` and the older `notes/Ato*.md`. Do not contradict them.

## How the map works

```
lib/ink-map/          the baked data and the three.js renderer
  data.ts             InkMapData: buildings, roads, areas, terrain, trees, origin
  renderer.ts         the G-buffer + composite passes
  shaders.ts          ink outlines, screentone, cast shadows, contours, fire glow
  hazard.ts           useHazard / useFireClock — the fire front over time
  place.ts            buildPlaceIndex / buildingForPoint — a screen point to a building
  contours.ts         terrainContours — marching squares over the height field
  camera.ts           the fixed framings

components/map/       the stage every screen shares
  map-stage.tsx       <MapStage>, useMapStage() — sizes itself, projects, picks ground
  ink-surface.tsx     the 3D surface
  paper-surface.tsx   the flat SVG surface
  layers.tsx          <Anchor>, <GeoAnchor>, <MapLine>, <GeoLine>, <Leg>, <GeoLeg>
  projection.ts       frame maths, TOWN_FRAME, closeupFrame, PAPER_FIT
  use-highlights.ts   turns need marks into red roofs
```

Two rules that cost Boris a day each, so take them seriously:

- **`MapStage` owns the projection.** Draw through `<GeoAnchor>` / `<GeoLine>` / `<GeoLeg>` and
  pass `LatLng`. Never compute your own screen coordinates; the ink renderer and the paper surface
  project differently and you will drift.
- **A frame is four numbers.** `view` is an inline object literal, so memoise on
  `[x0, y0, x1, y1]` or every road path rebuilds on every render. `frameEdges()` in `map-stage.tsx`
  already does this.

Highlighting a building red is `setBuildingStates(Map<buildingIndex, {level, pulse}>)`. The index is
`buildingForPoint`'s answer. Level 0–1 is how red the roof goes. That is how "people in need" are
shown on the map, and it is the most important thing on the screen.

## What is done

### Boris's foundation

- The map bake: 26,251 buildings from the December 2024 OSM snapshot, terrain, streets, parks,
  trees. `public/map/altadena.json` + `public/map/terrain.bin`. Never fetched live.
- The ink renderer, working at `/lab` with a fire scrubber.
- `components/map/*` — the shared stage, both surfaces, the overlay primitives.
- `components/ui/panel.tsx` and `components/ui/switch.tsx` — the dark floating panel and the
  neutral switch. Use these; do not invent a second panel.
- **The rescue map (`/map`)**: `components/rescue/*`. Left column (who needs a ride, neighbours named
  on calls), right column (plan, fleet, doors to knock, rider upload), bottom toolbar (look / draw
  zone / close a road, 3D–flat) and the fire scrubber.

### Shared pieces added in the takeover (use them, don't fork them)

- `components/ui/app-bar.tsx` — `<AppBar>` (product mark + screen nav, right-hand slot for controls)
  and `<WarningClock>`. Every screen uses it; `/map`'s `MapTopBar` is a thin wrapper. `AppNav`,
  `HeaderBar`, `PageShell` and `ui/section.tsx` are deleted.
- `components/ui/button.tsx` has an `onPaper` variant (ink on map paper) for controls that sit on a
  paper-coloured card.
- `.hatch` in `app/globals.css` (components layer) — diagonal hatching in `currentColor`, for "this
  no longer holds".
- `<MapStage>` falls back to `mode="paper"` by itself when WebGL cannot start
  (`InkMapCanvas` takes `onFail`). Before, a machine without WebGL crashed the whole screen.
- `StageTrack` and `Waveform` in `components/ui` are now drawn for the dark panel.

### Driver page — `components/driver/`

Boris pushed his own rebuild at 03:00 and a house-marker tweak at 03:20; this version replaced it and
kept his two best ideas (needs worked out from `stop.rider`, and the red house marker for homes the
map has no building outline for).

```
driver-page.tsx   picker + "hold offers" switch in the top bar, the map, the sheet below it
driver-map.tsx    fixed close-up (radius 120 m) on the focused stop, red roof + red house marker
                  with a pulse, numbered flags for run stops, the van and its dispatch:routes line
offer-cards.tsx   OfferCard (address, ETA with van glyph, need tiles, Accept + Decline; the offer
                  countdown is a fuse inside the Accept button) and ChangedCard (hatched paper,
                  struck-through address, "Got it")
ride-needs.tsx    glyph tiles: people, wheelchair, stretcher, crew, lift, O₂, medical
run-list.tsx      the accepted run in stop order, numbers match the map flags, "can't make it"
stops.ts          types, picker order, useDriverBoard (offers / changed / run, with hold logic)
```

Checked live: offer → hold on → offer withdrawn → late Accept rejected → card flips to changed, then
accept the new offer → run list.

### Call floor — `components/floor/` (`app/page.tsx` renders `floor/call-floor.tsx`)

```
call-floor.tsx       full-bleed map, AppBar with clock + controls, before-warning hero,
                     left column (reach panel + tabs: On the phone / Next to call / Activity),
                     right column (listening in)
floor-map.tsx        the calling area (convex/model.ts AREA, padded for the side panels) on the
                     real map; every household marked on its roof, red roofs for riders, the next
                     six homes to call numbered, the followed call ringed and labelled
household-mark.tsx   THE encoding for a household, used by the map, the chart and the legend:
                     red square = accessible van, red dot = needs a ride, ink ring with a hole =
                     on the phone, faint ink dot = leaving, X = unreachable, hollow ring = no answer
reach-panel.tsx      big "answered" count, 200-cell unit chart that doubles as the legend, and
                     the redial → texted → door check ladder
line-list.tsx        live lines (selected = raised fill + left bar + headphones)
listening-panel.tsx  record fields, then a Slack-style transcript: agent turns on a raised
                     surface with a bot avatar and latencyMs, resident turns plain
queue-list.tsx, activity-list.tsx
floor-controls.tsx   line stepper, inbound surge, dialer toggle, and the stand-in switches +
                     reset behind one "Stand-ins" popover
```

The old call-floor components, `coverage-map.tsx` and `components/map/base-layers.tsx` are deleted.

### Under the hood — `components/system/`

Paper page, three columns of dark panels: **Right now** (`close-road.tsx`, `live-panels.tsx`:
re-plan, request flow, callback timing, audit trail), **The calls** (`call-panels.tsx`: accuracy
with intervals, turn latency, honesty by status, red-team change cases), **The dispatch**
(`dispatch-panels.tsx`: simulator differences, door-check fairness with a scenario picker).
`range.tsx` has `RangeRow` (dot = value, bar = range, optional zero line), and every result number
goes through it. `results.ts` types the files, and `/api/results` now also serves
`honesty-results.json`, `door-fairness.json` and `redteam-change-cases.json`. Each team's `label`
sits under its panel.

**"Close this road"** lives here (the plan put it on this screen, not `/phone`). For each driver-page
van with a pickup it closes the last stretch of that van's real route before the door. When there is
no route (the dispatch stand-in drives straight lines) it closes a short line across the approach
70 m before the house instead. Either way it writes a `manual` closure through
`roads:addClosures`. There is no "reopen" mutation yet.

### `/phone` — `components/phone/phone-panel.tsx`

A thread list (a dot marks threads waiting on a reply) and a handset with SMS bubbles, one-tap 1 / 2 / 3
replies and a free-text reply. The "simulated" label is in the app bar.

### Backend touches

- `convex/control.ts` `clearTables`: the delete batch is now one read budget shared across tables.
  Before, reset failed with "Too many reads" once there was a real night's data, and nothing cleared.
- `convex/estimates.ts` `agentLines` also returns `latencyMs` (note in `notes/AtoD.md`).
- `convex/offers.ts` is Boris's version (with `riderFacts`); the driver page reads `stop.rider`.

## What is still open

1. **Verify `/map` against a live incident.** Nobody has done this yet:

   ```bash
   npx convex run control:reset
   npx convex run control:issueWarning
   ```

   Then check, in order: red roofs on the buildings where people are waiting; pins for escalations;
   the "who needs a ride" count matching the pins; a drawn zone; a closed road snapped onto the real
   street; an offer approved by hand; and the flat surface showing the same thing as the 3D one.
2. **Flat surface on the new screens.** The driver page and the call floor pass `fronts` so the paper
   fallback draws the fire, but neither has been looked at in `mode="paper"` yet.
3. **The demo run end to end** with the driver page on a real phone: Maria accepts Carmen, close the
   road from `/system`, the revoke and the "This assignment changed" card on Luis's old offer.
4. `/system` shows "–" for requests and vehicles while the dispatch stand-in is on, because only the real
   dispatcher fills `requestCount` / `vehicleCount`.

## Working in this checkout

Several Claude sessions share the same clone. A `git rebase --autostash` in one session can pull
files into another session's working tree mid-edit, and leaves `autostash` entries in
`git stash list`. Re-read a file (and `git log -1 -- <file>`) right before you overwrite it, and never
drop a stash you didn't create.

To test screens without touching the shared deployment, copy `convex/` and
`data/roads/altadena.json` into a scratch folder that has `package.json` and a `node_modules`
symlink, then run there:

```bash
CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable --local-cloud-port 3320 --local-site-port 3321
```

Point Next at it with `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3320 npx next dev -p 3100`. For
headless screenshots, launch Chrome with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`, or
WebGL won't start and you'll only see the flat fallback.

## The bar

Before you call a screen finished, screenshot it and critique it the way a professional designer
would, out loud, as if it were going in your portfolio. Then fix what you found and do it again.
Specifically:

- Cover the words. Can you still tell what each region is and what each button does? If not, the
  layout is wrong, not the copy.
- Is there exactly one thing the eye lands on first, and is it the right thing?
- Is any element in a box of the same size and weight as its neighbours, when it should be
  dominating or receding?
- Is anything on the screen there because it was easy to add?
- Every state has a visible change. "Selected" is a ring, not the word "selected". Disabled is a
  real loss of contrast. A locked thing is hatched, not labelled.

Use Playwright to check. Save screenshots with **absolute paths** — relative names have silently
not landed in the workspace here before. Verify animation frame by frame rather than trusting the
CSS. Close every browser session, tab and page, and stop any dev server you started, before you
stop for the day.

## House rules you will be judged on

- **Only `main`.** Never a branch, never a force-push, never a rewritten history.
  `git pull --rebase origin main` before you start and before every commit. Push right after each
  commit, in small commits. Watch `main` for pushes while you work.
- `npm run typecheck && npm run lint` must pass before every push. Cyclomatic complexity over 15
  fails lint. A complexity failure is a failing test, not a warning.
- `convex/schema.ts` and the functions named in `PLAN.md` under "Contract" are shared. Before
  changing a shape someone else reads, write a note to everyone it affects.
- Never break a stand-in someone is building against; turn it off with its switch on the call floor.
- Notes between people live in `notes/<from>-to-<to>.md` (`notes/boris-to-brendan.md`). Only the
  sender writes their file. Add each note at the bottom under a `## YYYY-MM-DD HH:MM` heading.
- No summary markdown files, no `.backup` or `.pre-features` copies. Git is the history.
- Secrets never go in git. `.env.local` is gitignored.

## Running it

```bash
npx convex dev          # local backend, terminal 1
npx next dev -p 3100    # the app, terminal 2 — http://localhost:3100
```

Screens: `/` call floor, `/map` rescue map, `/driver` driver page, `/phone` simulated handset,
`/system` under the hood, `/lab` the map bench (both surfaces, a fire scrubber, nothing else).

The team also has a shared Convex deployment and a live voice server on Fly. Brendan's note
`notes/BtoA.md` has the URLs and what to put in `.env.local`. The local deployment is fine while you
build; switch before the demo.
