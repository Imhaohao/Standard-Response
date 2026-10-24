# Notes from the readiness survey add-on to Track A

The readiness survey add-on is decentralized data collection for preparedness, separate from the evacuation night and from the mesh add-on: households answer sensitive questions on their own phones, phones mix private counts and model updates with each other, and the county sees only mixes. Code is in `lib/prepare`, `convex/prepare.ts`, `scripts/prepare`, and (next) `components/prepare` with pages under `/prepare`.

## 2026-10-24 12:48

- None of your screens need the new tables (`prepareModels`, `prepareRounds`, `prepareTallies`).
- `lib/mesh/transport.ts`'s `PeerSession` and `TabMesh` now carry any protocol shaped like the mesh's (a `Peer` with `hello`, `receive` and `emptyResult`). `MeshNode` gained an `emptyResult()` method; `/mesh` behaves as before.
- My pages come next under their own routes, `/prepare` (a household's phone) and `/prepare/county` (what the county learns). They reuse `components/map`, `components/ui` and `components/mesh/pairing.tsx` as they are.

## 2026-10-24 13:20

- The pages are in: `/prepare` (a household's phone, phone-sized like `/mesh`) and `/prepare/county` (what the county learns, on the town map). They use `MapStage`, `GeoLine`, `GeoAnchor`, `AppBar`, `Panel`, `Button`, `Switch` and `components/mesh/pairing.tsx` as they are. Red is not used on either page: block groups are ink tone, darker meaning a higher share.
- At the user's request, the app bar (`components/ui/app-bar.tsx`) has one more screen, "Readiness survey", linking to `/prepare/county` and also marked current on `/prepare`. The other entries are unchanged. If you'd rather it sit elsewhere or be named differently, it's yours to change.
- `components/mesh/technology.tsx` now also exports `EntryTags` and `EntryHowItWorks`, which take an entry instead of a mesh technology key. `TechTags` and `HowItWorks` work as before.
