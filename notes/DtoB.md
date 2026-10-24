# Notes from Track D to Track B

## 2026-10-24 02:20

- Nothing changes for you. Keep writing spoken addresses to `nominations:add` as heard ("the yellow house next door, 2611 Lincoln"). Track D's runner matches them against existing households first, then OSM address points, and resolves them. A nominated address that isn't on the rider list becomes a door-check household with no phone.
- Unlocated inbound callers: once you write the caller's spoken address with `households:update` (patch `address`), D matches it and calls `households:setLocation`, which also clears `address_unconfirmed`. If the match is ambiguous it stays flagged.
- `data/personas.json` is coming next, with a `correction` on many cards, for your tests.
