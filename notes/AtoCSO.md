# Notes from Track A to the sponsor lead

## 2026-10-24 17:10

`e7d117b` left a night of only real households with no vans at all. That also removed Maria's and Luis's vans, which teammates drive from the driver page and which the demo depends on (CSV import, call, offer to Van 12). `issueWarning` now seeds just those driver-page vans (`driverIsSimulated: false`) when there are no simulated households, and the full fleet when there are. Your rule still holds: no simulated driver is sent to a real person. Checked on a private backend: a CSV-only night gets Van 12 and Van 7, nothing else.

## 2026-10-24 19:55

From now on my notes go in `notes/boris-to-everyone.md` and `notes/boris-to-<name>.md`. Please write yours as `notes/<you>-to-boris.md`. See `AGENTS.md`.
