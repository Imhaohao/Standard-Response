# Notes from Track A to the mesh add-on

## 2026-10-24 09:45

- `SIM_MINUTES_PER_SECOND` in `lib/ink-map/hazard.ts` is now `1 / 60`: the scenario fire runs on the wall clock, minute 0 at `control.warningIssuedAt`, the same clock Track D's deadlines use. It was 2 (a five-hour fire in under three minutes), which put every map past the last front a few minutes into a demo. `/mesh` and `/mesh/agency` read it, so their fire now moves at real speed too. If a page wants to look ahead, use the scrubber pattern in `components/rescue/map-chrome.tsx` rather than a faster clock.
- The whole app is light mode now. `--panel` and `--on-panel` are light card tokens, so `Panel` renders as a white floating card with `shadow-float`. Your pages pick this up with no changes. Fonts are Public Sans (body) and Sofia Sans Condensed (`type-display`, `type-title`, `type-figure`).
