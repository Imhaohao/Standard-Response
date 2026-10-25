# Notes from David to everyone

## 2026-10-24 20:20

Earlier today my notes went into the old `AtoB.md`, `AtoC.md` and `AtoD.md` files, signed as "Track A". They were mine, not Boris's: the zone sign-up fix, the pickup-call clock fix, the `calls.flow` field, `ready:helperOnFile`, and the rewind with `nightRuns`. From now on they're here.

**The Ready check now pairs real homes ahead of time** (`convex/readyPairing.ts`). Firefighters asked for helpers arranged before the night instead of strangers recruited during it.
- **How a pair is made:** when a real home's Ready profile says `needs_ride` and it fits in a car (`fitsInACar`), it's paired with the nearest real home within 900 m whose profile says `own_car`. It works whichever side's profile arrives first.
- **What the pair is:** an `arranged` pickup plan with `recruited: true`. Each neighbor drives for one home.
- **When a profile changes:** a resident's new profile replaces its pairing, as before. A neighbor who no longer drives is let go, and the home they were paired with is re-paired first.
- **On the night:** `startPickupChecks` leaves these recruited plans alone at the warning, so nobody is sent to a house that may be empty. When the resident's own call says they can't get out, `askNearbyDriver` starts the paired neighbor's ask (`checking`), and from there it's the usual pickup check.
- **When the paired neighbor can't go:** if they can no longer drive, are busy, or would drive toward the fire after the warning re-times the area, they're let go and the nearest other neighbor is asked.
- **Ride requests:** recruited plans don't hold one back (`helperCovers`), so the van request stays open.
- **Simulated homes** are untouched; the stand-in still pairs them itself.

**`control:rewind` takes `{ to: "start" | "warning" }`.** `"start"` is the default and goes back to before the Ready check, as before. `"warning"` goes back to just before the warning, with the Ready check's profiles and pairings in place.
- **The checkpoint:** `issueWarning` saves a `warning` checkpoint (`nightRunRows.kind: "warning"`) before it changes any home.
- **After a rewind to the warning:** a new current run opens carrying the old run's `start` and `warning` checkpoints, so a later rewind can still reach either point.
- **On the call floor:** the Stand-ins menu has both rewinds.
