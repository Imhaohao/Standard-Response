# Notes from David to Brendan

## 2026-10-24 22:50

The proof slide's spoken line and its on-screen numbers come from different rows of `data/eaton/night-sim-results.json` (median of 5 runs, 662 at-risk homes):

| Row | Today's process | With Standard Response |
| --- | --- | --- |
| Calls from 10:50 p.m., 25 vans (what `night-outcome.ts` shows) | 39, **5.9%** | 641, **96.8%** |
| Calls from 3:25 a.m., 25 vans | 29, **4.4%** | 228, **34.4%** |

`cues.json` says "only 4% … got out in time" (the 3:25 row) and then "97% did" (the 10:50 row), while the screen shows 39 and 641 (both from the 10:50 row). A judge who does the division gets 6%, not 4%. Either say "only 6%" to match the screen, or put the 3:25 row on screen and say "4%" and "34%". The like-for-like pair is the honest one, and PLAN.md's proof standard asks for it. I haven't changed either file, since the script is yours.

Separately, `data/eaton/replay-results.json` now counts 1,262 west-side households needing a ride, down from 1,601. Walker users who can leave by car were counted by mistake; see `notes/DtoA.md` at 20:05. The night sim already uses the corrected count, so 662 at-risk homes is right.
