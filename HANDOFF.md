# Picking up Boris's work

You are taking over the interface of a hackathon app. Boris built the map and the rescue map and
ran out of runway. The driver page, the call floor and two smaller screens are still the old
design. Your job is to finish them in the same language, and to make them look really freaking
good — not "good enough for a demo", good.

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
3. `notes/*toA.md` — what the other three tracks have told Track A. There are 12 note files; the
   three addressed to `A` are the ones you need.
4. Every `notes/Ato*.md` — what Boris already told the other tracks. Do not contradict it.

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

- The map bake: 26,251 buildings from the December 2024 OSM snapshot, terrain, streets, parks,
  trees. `public/map/altadena.json` + `public/map/terrain.bin`. Never fetched live.
- The ink renderer, working at `/lab` with a fire scrubber.
- `components/map/*` — the shared stage, both surfaces, the overlay primitives.
- `components/ui/panel.tsx` and `components/ui/switch.tsx` — the dark floating panel and the
  neutral switch. Use these; do not invent a second panel.
- **The rescue map (`/map`) is rebuilt**: `components/rescue/*`. Top bar with the screen nav and the
  elapsed clock, a left column (who needs a ride, neighbours named on calls), a right column (the
  plan, the fleet, doors to knock, the rider upload), a bottom toolbar (look / draw zone / close a
  road, 3D–flat) and a fire scrubber that moves the scenario's `minutesAfterWarning`.
- `convex/estimates.ts` returns the shape Track D documented.

**But the rescue map has not been verified against a live incident.** Boris only ever saw it against
a finished dataset, where every request was already `arrived` and no panel had anything in it. Reset
the demo and look at it with the fire moving and people waiting:

```bash
npx convex run control:reset
npx convex run control:issueWarning
```

Then check, in order: red roofs on the buildings where people are waiting; pins for escalations;
the "who needs a ride" count matching the number of pins on the map; a drawn zone; a closed road
snapped onto the real street; an offer approved by hand; and the flat surface showing the same
thing as the 3D one.

## What is not done — your actual job

In the order Boris would have done them.

### 1. The driver page — `components/driver/driver-page.tsx`

This is a phone screen and it is the one a real volunteer would use in a car, so it has to be
readable at arm's length in daylight. It is still the old design.

What it must do:

- Open on a **close-up of the pickup** (`{kind: "closeup", center, radius}`), with the building the
  rider is in glowing red so the driver can see *which house* before reading anything.
- Show the rider's needs **visually**: how many people, how many wheelchairs or stretchers, whether
  they need a lift, oxygen, or a crew. Glyphs and counts, not sentences.
- Two big buttons. Accept and Decline. They must be the largest thing on the screen.
- A countdown on the offer. `OFFER_TTL_MS` is in `convex/model.ts`.
- **"This assignment changed"** — when a re-plan replaces or revokes the run while the driver is
  looking at it, the screen must say so loudly and show the new one. This is the state the whole
  project is about; do not bury it.
- Once accepted: the run in stop order, with the driving route from `dispatch:routes`.
- A driver picker, and the "hold offers until I tap" checkbox.

### 2. The call floor — `app/page.tsx`

Still the old grey design. It has a **fake map**: `components/map/base-layers.tsx` draws invented
streets and fire contours. Delete that and put the real `<MapStage>` behind the floor.

Keep these, restyled: `LiveLines`, `CallDetail`, `CallQueue`, `RetryLadder`, `EventFeed`,
`HarnessPanel`. The transcript is the thing people will actually look at during the demo — give the
resident and the agent real hierarchy, with the agent's turn on its own distinct surface. Read the
"chat and transcript views" rule in `~/.claude/CLAUDE.md` before you style it.

`ReachPanel` is a wall of text. It is counting how much of the town we have reached. Draw that, do
not write it.

### 3. `/system` and `/phone`

Light restyles. `/system` (under the hood) shows the model results from `data/*.json`; Track D's
notes in `notes/DtoA.md` say what each file's shape is and which label must stay visible next to
which number. `/phone` is the simulated handset; keep the "Close this road" demo control where the
plan says it belongs.

### 4. Cleanup

- Delete `components/rescue/map-view.tsx`, `components/rescue/field-lists.tsx`,
  `components/rescue/dispatch-list.tsx`, `components/rescue/plan-summary.tsx` and
  `components/map/base-layers.tsx` once nothing imports them. Check with `grep -rn` first.
- `convex/estimates.ts` was edited by Track A. Track D owns it. Read `notes/AtoD.md` first.

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
- `convex/schema.ts` and the functions named in `PLAN.md` under "Contract" are shared. Change only
  the tables your track owns and write a note to every reading track first.
- Never break another track's stand-in; turn yours off with its switch on the call floor.
- Notes between tracks live in `notes/<X>to<Y>.md`. Only the sending track writes its file. Add each
  note at the bottom under a `## YYYY-MM-DD HH:MM` heading.
- No summary markdown files, no `.backup` or `.pre-features` copies. Git is the history.
- Secrets never go in git. `.env.local` is gitignored.

## Running it

```bash
npx convex dev          # local backend, terminal 1
npx next dev -p 3100    # the app, terminal 2 — http://localhost:3100
```

Screens: `/` call floor, `/map` rescue map, `/driver` driver page, `/phone` simulated handset,
`/system` under the hood, `/lab` the map bench (both surfaces, a fire scrubber, nothing else).

The team also has a shared Convex deployment and a live voice server on Fly. Track B's note
`notes/BtoA.md` has the URLs and what to put in `.env.local`. The local deployment is fine while you
build; switch before the demo.
