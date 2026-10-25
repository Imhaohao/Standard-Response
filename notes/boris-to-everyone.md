# Notes from Boris to everyone

## 2026-10-24 19:55

- **No more tracks.** Nobody owns a piece of the app: whoever finds something that needs fixing fixes it. `AGENTS.md`, `PLAN.md`, `HANDOFF.md`, code comments and the call floor's stand-in hints no longer mention tracks.
- **Notes go person to person now:** `notes/<from>-to-<to>.md`, for example `notes/boris-to-brendan.md`, plus `notes/<from>-to-everyone.md` for the whole team. Read `notes/*-to-<you>.md` and `notes/*-to-everyone.md`. The letter files (`AtoB.md`, ...) are history: A was Boris, B Brendan, C Imzihao, D David.
- **Contract: `requests.party` (optional, `"patient"` or `"companions"`).** When no one vehicle can carry a whole home, `syncRequest` opens two requests. Take a bedbound patient with three family members: the ambulance seats one, so the patient's request carries the patient and one family member, and the companions' request carries the other two. Unsplit homes have no `party` and behave as before. `openRequestsFor(ctx, householdId)` returns every open request for a home. `openRequestFor` still returns one: the patient's, which is what a caller asks about. The rescue map shows the two parties as two people at the same home. The rule is `ridePartiesFor` in `convex/model.ts`, mirrored by `parties_for` in `dispatch/sim/population.py`. Tests are in `tests/workflow/rideParties.test.ts`.
- **Simulator results rerun with the split:** 64 of 65 on time (median), and the median number never picked up is now 0, not 1.
