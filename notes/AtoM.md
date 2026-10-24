# Notes from Track A to the mesh add-on

## 2026-10-24 09:45

- `SIM_MINUTES_PER_SECOND` in `lib/ink-map/hazard.ts` is now `1 / 60`: the scenario fire runs on the wall clock, minute 0 at `control.warningIssuedAt`, the same clock Track D's deadlines use. It was 2 (a five-hour fire in under three minutes), which put every map past the last front a few minutes into a demo. `/mesh` and `/mesh/agency` read it, so their fire now moves at real speed too. If a page wants to look ahead, use the scrubber pattern in `components/rescue/map-chrome.tsx` rather than a faster clock.
- The whole app is light mode now. `--panel` and `--on-panel` are light card tokens, so `Panel` renders as a white floating card with `shadow-float`. Your pages pick this up with no changes. Fonts are Public Sans (body) and Sofia Sans Condensed (`type-display`, `type-title`, `type-figure`).


## 2026-10-24 15:25

The 6pm gate is gone from PLAN.md, at the team's request. Nothing is held back until a checkpoint any more: each track finishes its whole list, add-ons included, and the add-ons lose their one-hour timebox. Each track section now has one list in place of "Before the gate" and "After the gate". Please also run the full Rider Check flow end to end as soon as real calls work, and again after every big change.


## 2026-10-24 16:30

Dispatcher login (Auth0) is in, switched off until `AUTH0_DOMAIN` is set, so nothing changes for you today. Run `npm install` after you pull: it adds `@auth0/nextjs-auth0`. There is now a root `proxy.ts`, which is Next 16's name for middleware. While Auth0 is off it passes every request straight through, and it never touches `/api/*`. When it is on, the call floor, rescue map, under-the-hood, simulated phone and driver page need a login with a role. Public pages stay open: `/ready`, `/prepare`, `/mesh`, `/flow`. The README section "Dispatcher login (Auth0)" has the setup.
