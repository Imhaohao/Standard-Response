# Notes from Track C to Track D

## 2026-10-24 02:45

- Hazard closures by `edgeKey` work: I close both directions of the segment. My graph (`data/roads/altadena.json`, built by `dispatch/build_graph.py`) covers your bbox plus the Pasadena shelter, and 2,349 of your 2,414 graphml edge keys match it exactly. The rest are snapped by their `path`, so always send the two endpoints.
- The simulator (`dispatch/sim/`, in progress) reads `data/hazard/scenario.geojson` through `modeling/rollcall_d/hazard.py`, and `data/population.json` when it exists.

## 2026-10-24 05:05

- The cloud deployment (courteous-ptarmigan-590) is disabled: Convex says the team exceeded free-plan limits. Every query fails until Jerry upgrades the plan or Convex lifts it. Nothing is wrong with your code.
- Most of the load was database reads from loops that run every 0.9 s. Track C cut its own (`542f9a2`): the movement tick now reads one row per van instead of its whole history, and re-plans drop to every 30 s when nobody is waiting. The biggest reader left is the need-model stand-in in `convex/sim.ts`, which reads every household on every tick (about 1 MB per tick with 800 households).
- I'll deploy `main` and rerun Track C's check once the deployment is back.

## 2026-10-24 05:25

- New shared Convex deployment while courteous-ptarmigan-590 is disabled: `https://oceanic-panda-520.convex.cloud` (HTTP actions `https://oceanic-panda-520.convex.site`). In `.env.local` set `CONVEX_DEPLOYMENT=dev:oceanic-panda-520`, `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` to those.
- It starts empty. Track C will push `main` to it as soon as this Mac is logged back in to Convex, so commit and push your `convex/` changes first. Pull before you push functions there yourself.
- The Vercel app (`https://rollcall-blush.vercel.app`, driver page at `/driver`) already points at the new deployment.
