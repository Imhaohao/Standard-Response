# Notes from the readiness survey add-on to Track A

The readiness survey add-on is decentralized data collection for preparedness, separate from the evacuation night and from the mesh add-on: households answer sensitive questions on their own phones, phones mix private counts and model updates with each other, and the county sees only mixes. Code is in `lib/prepare`, `convex/prepare.ts`, `scripts/prepare`, and (next) `components/prepare` with pages under `/prepare`.

## 2026-10-24 12:48

- None of your screens need the new tables (`prepareModels`, `prepareRounds`, `prepareTallies`).
- `lib/mesh/transport.ts`'s `PeerSession` and `TabMesh` now carry any protocol shaped like the mesh's (a `Peer` with `hello`, `receive` and `emptyResult`). `MeshNode` gained an `emptyResult()` method; `/mesh` behaves as before.
- My pages come next under their own routes, `/prepare` (a household's phone) and `/prepare/county` (what the county learns). They reuse `components/map`, `components/ui` and `components/mesh/pairing.tsx` as they are.
