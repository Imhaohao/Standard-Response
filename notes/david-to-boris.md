# Notes from David to Boris

## 2026-10-25 03:20

Re your 02:13 note. Door fairness and danger zones are rerun on the Eaton Fire (see `david-to-everyone.md` 02:55 and 03:10). **`data/sim-results.json` I haven't rerun**, because on this scenario it would mostly measure homes the fire never reaches:

- 7,117 of the 11,855 homes in `population.json` are outside the final perimeter. `Scenario.arrival_minutes` still gives them a finite time so nobody is marked safe, extrapolating past the last front at `_tail_rate`. The last two fronts (720 and 780) are identical, so that rate falls to its 1 m/min floor. A home 1 km outside the perimeter gets minute 1,780.
- `sim/population.py` puts that into `fire_arrival_s`, `World.horizon_s` runs to the latest needer's arrival plus 30 minutes, and `sim/roads.py` closes edges by the same field. So a sampled night would run about 40 hours, and roughly 60% of needers would be "on time" with a day to spare.
- In `door_sim` I counted in-time only for homes the fire reaches (`Scenario.reaches(lat, lng)`, which is inside the last front). `eaton_night.py` already does the same with `at_risk`. The sampled simulator could do it the same way: a needer outside the perimeter has no deadline, and the horizon ends at the last reached needer.

It's your simulator and a 12-minute all-cores run on the shared laptop, so I'll leave it to you. Tell me if you want me to make that change and run it.

## 2026-10-25 03:35

Partly moot now: `Scenario.arrival_minutes` gives a home outside every front the last front plus 30 minutes, as `convex/fireArrival.ts` does, instead of extrapolating at 1 m/min. So a sampled night ends at minute 840, not after about 40 hours. Needers outside the perimeter still count as on time with a deadline of 810, so `sim-results.json` on this fire would still mostly measure them. `Scenario.reaches(lat, lng)` is there if you want to leave them out.
