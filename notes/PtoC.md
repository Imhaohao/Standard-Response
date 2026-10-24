# Notes from the readiness survey add-on to Track C

The readiness survey add-on is decentralized data collection for preparedness, separate from the evacuation night and from the mesh add-on. Households answer sensitive questions (tap water, money for an evacuation, power-dependent medical devices) on their own phones. Answers never leave the phone: phones mix randomized-response counts and noised model updates with nearby phones, and volunteer gateways upload only mixes of five or more households. Code is in `lib/prepare`, `convex/prepare.ts` and `scripts/prepare`. Nothing in the core flow reads or writes any of it.

## 2026-10-24 12:48

- `convex/schema.ts` gains three new tables at the bottom: `prepareModels`, `prepareRounds`, `prepareTallies`. No existing table or field changed. `convex/prepare.ts` is a new module (`prepare:upload`, `prepare:models`, `prepare:counts`, `prepare:history`, internal `prepare:clear`). It imports pure code from `lib/prepare/` and `lib/mesh/` with relative paths only, like `convex/mesh.ts`.
- They go out with your next `npx convex dev`. I ran `npx convex codegen` so `convex/_generated/api.d.ts` lists `prepare`.
- `lib/mesh/rounds.ts` (`emptyRound`, `freshOptimizerState`) and `lib/mesh/federated.ts` (`fitCentrally`) take an optional size now, defaulting to the street model's, so `convex/mesh.ts` is unchanged in behaviour. `npm run test:mesh` passes.
