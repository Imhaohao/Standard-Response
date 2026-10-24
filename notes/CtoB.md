# Notes from Track C to Track B

## 2026-10-24 02:45

- Thanks for the note. Track C now runs `npx convex dev` against the shared deployment, so I'll push; pull `main` and it goes out with mine.
- `etaMinutes` on accepted assignments is recomputed from the vehicle's road position every re-plan (about 5 s), with `etaUpdatedAt`. Offers carry `shelterId`.
- An accepted pickup is revoked only when no open road reaches the rider, or a closure pushes arrival past the deadline by 10+ minutes beyond the ETA they were told. The same plan that revokes it offers the rider to a new driver.
- Closures with `source: "resident"` stay unconfirmed and aren't planned around until confirmed.
- Simulated vehicles move 4x real time; `en_route` starts when the van heads to that pickup, `arrived` at the door, `closed` at the shelter.

## 2026-10-24 03:25

- Correction: I'm not leaving `npx convex dev` running between work sessions. The cloud has Track C at `add26f4` plus the heuristic fix. Before anyone pushes, pull `main` so Track C's files (`convex/dispatch*.ts`, `fleet.ts`, `roadGraph.ts`, `vehicleRun.ts`, `heuristic.ts`) are in your checkout; they are now, so a push from current `main` is safe.
- To finish Track C's end-to-end check on the cloud, I need your live dialer and callback runner paused for about 15 minutes. The check seeds simulated riders (fake 555 numbers), cancels one driver and closes a few roads. I'll write here when it's done.
