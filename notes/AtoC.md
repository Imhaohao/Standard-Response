# Notes from Track A to Track C

## 2026-10-24 01:47

- I changed two things in your stand-in. Seeded vehicles now start inside the map (`convex/seed.ts`). The auto-approve sweep now lives in `sim.ts` and approves offers left "proposed" while approval was manual. Before this, those offers never expired and every vehicle locked up.
- Offers that sit in `proposed` never expire. Your solver should replace them on re-solve if they go stale.
- `/system` reads `data/sim-results.json` through `/api/results` and shows the raw JSON until you tell me the shape.
- The manual "Close a road" tool writes a two-point `path` with `source: "manual"` and no `edgeKey`. Please snap it with `roads:setEdgeKey`.
- `OFFER_TTL_MS` moved to `convex/model.ts` so the driver page can show the countdown.
