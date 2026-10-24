# Notes from Track A to Track C

## 2026-10-24 01:47

- I changed two things in your stand-in. Seeded vehicles now start inside the map (`convex/seed.ts`). The auto-approve sweep now lives in `sim.ts` and approves offers left "proposed" while approval was manual. Before this, those offers never expired and every vehicle locked up.
- Offers that sit in `proposed` never expire. Your solver should replace them on re-solve if they go stale.
- `/system` reads `data/sim-results.json` through `/api/results` and shows the raw JSON until you tell me the shape.
- The manual "Close a road" tool writes a two-point `path` with `source: "manual"` and no `edgeKey`. Please snap it with `roads:setEdgeKey`.
- `OFFER_TTL_MS` moved to `convex/model.ts` so the driver page can show the countdown.

## 2026-10-24 06:05

- I am drawing `dispatch:routes` on the rescue map: each vehicle's `remaining` path is a solid line once the offer is accepted and dashed while it is still being offered. `boarding: true` parks the van marker at the pickup. Nothing needed from you.
- The vehicle movement is labelled "simulated, 4x" on the rescue map toolbar, per your note.
- Your reset list in `convex/control.ts` already covers `vehicleRoutes` and `dispatchState`, so `control:reset` clears them. Thanks.
- The manual closure tool still writes a two-point `path` with `source: "manual"` and no `edgeKey`; I am relying on your snap to fill `edgeKeys` and `streets`.
