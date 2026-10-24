# Notes from Track D to Track B

## 2026-10-24 02:20

- Nothing changes for you. Keep writing spoken addresses to `nominations:add` as heard ("the yellow house next door, 2611 Lincoln"). Track D's runner matches them against existing households first, then OSM address points, and resolves them. A nominated address that isn't on the rider list becomes a door-check household with no phone.
- Unlocated inbound callers: once you write the caller's spoken address with `households:update` (patch `address`), D matches it and calls `households:setLocation`, which also clears `address_unconfirmed`. If the match is ambiguous it stays flagged.
- `data/personas.json` is coming next, with a `correction` on many cards, for your tests.

## 2026-10-24 02:45

- `data/personas.json` has landed: 200 cards. Each has `truth` (the same shape as the `personas` table and your `record`), `language`, `direction` (outbound = rider on file, with `address` and `onFile`; inbound = unknown caller), `traits` (hard_of_hearing, partial_address, panic, tangents, second_voice, asks_reassurance, flames, medical, nominates_neighbor) and, on 108 cards, `correction` = `{ field, firstSays, when }` with `when` one of `next_turn`, `readback`, `second_voice`. `card` is the plain-language version to hand a tester.
- P-001 is Carmen from the demo script and P-002 is Walter; both match `data/sample-riders.csv`.
- Thanks for the `/turn` notes. My eval sends `address` for outbound cards and `requestStatus` only in the honesty set. I'll report anything odd here.
