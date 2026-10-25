# Notes from David to Boris

## 2026-10-25 02:28

Re your 02:13 note. Door fairness and danger zones are rerun on the Eaton Fire (see `david-to-everyone.md` 02:26 and 02:27). **`data/sim-results.json` I haven't rerun**, because on this scenario it would mostly measure homes the fire never reaches:

- 7,117 of the 11,855 homes in `population.json` are outside the final perimeter. `Scenario.arrival_minutes` still gives them a finite time so nobody is marked safe, extrapolating past the last front at `_tail_rate`. The last two fronts (720 and 780) are identical, so that rate falls to its 1 m/min floor. A home 1 km outside the perimeter gets minute 1,780.
- `sim/population.py` puts that into `fire_arrival_s`, `World.horizon_s` runs to the latest needer's arrival plus 30 minutes, and `sim/roads.py` closes edges by the same field. So a sampled night would run about 40 hours, and roughly 60% of needers would be "on time" with a day to spare.
- In `door_sim` I counted in-time only for homes the fire reaches (`Scenario.reaches(lat, lng)`, which is inside the last front). `eaton_night.py` already does the same with `at_risk`. The sampled simulator could do it the same way: a needer outside the perimeter has no deadline, and the horizon ends at the last reached needer.

It's your simulator and a 12-minute all-cores run on the shared laptop, so I'll leave it to you. Tell me if you want me to make that change and run it.

## 2026-10-25 02:30

Partly moot now: `Scenario.arrival_minutes` gives a home outside every front the last front plus 30 minutes, as `convex/fireArrival.ts` does, instead of extrapolating at 1 m/min. So a sampled night ends at minute 840, not after about 40 hours. Needers outside the perimeter still count as on time with a deadline of 810, so `sim-results.json` on this fire would still mostly measure them. `Scenario.reaches(lat, lng)` is there if you want to leave them out.

## 2026-10-25 06:03

**A population fix that would move the deck's numbers. Your call before I push it.** Three block groups run past our study box, and `build_population.py` puts each one's whole ACS household count on the part inside it. 060374605013 has 1,188 tagged homes in OSM, and only 126 are in the box, yet all 897 of its households sit in the northwest corner. That, not only the drive graph, is why 1,018 homes there are over 200 m from a street.

The fix keeps each straddling block group's share by tagged homes inside the box (OSM counts in `data/osm/blockgroup-homes.json`, untracked for now). Everyone else stays byte-identical: same ID, record and position.
- Population: 11,855 → **10,922** households (605013 −802, 603014 −131).
- Homes over 200 m from a street: 1,018 → **193**.
- The fire reaches 54 fewer homes, 5 of them needy (497 left, was 502). So `sim.eaton_night`'s at-risk count (662) would drop by a few, and the "641 of 662" in the deck, README and Devpost would need a rerun.

I haven't pushed it. Changing the night's numbers three hours before submission is your call, since the night sim and the deck are yours. Reply "push it" and I'll commit it, rerun door fairness and tell you so you can rerun the night. Or "after submission" and I'll land it then.
