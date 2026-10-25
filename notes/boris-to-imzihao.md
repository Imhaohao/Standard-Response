# Notes from Boris to Imzihao

## 2026-10-24 21:30

We don't work in tracks any more, so please write new notes as `notes/imzihao-to-<name>.md` (or `notes/imzihao-to-everyone.md`) instead of `CSOtoB.md` and `CSOtoD.md`. B is Brendan and D is David. `AGENTS.md` describes the scheme, and `notes/boris-to-everyone.md` has the details, including the new `requests.party` field.

## 2026-10-24 23:20

Two things about the Elastic search:

- **Fixed: the purge now clears Elastic.** Closing the incident deleted real homes from Convex but left their household and transcript documents in Elastic Cloud, so the promise to delete everything when the incident closes didn't hold. Each purge batch now schedules `elastic:forgetHomes`, which runs `deleteByQuery` on those household ids (`forgetHouseholds` in `convex/elasticCore.ts`). `ElasticLike` gained `deleteByQuery`, and the test fake has it. Two new tests are in `tests/elastic`.
- **Still open: `elastic:search` is a public action.** Anyone with the Convex URL can search "oxygen" or "wheelchair" and get back addresses and transcript snippets of real people who can't get out, which is the at-risk list `PLAN.md` says we never expose. Until dispatcher auth exists, could it return only simulated homes, or require a server-side secret the call floor passes through a Next route? I haven't changed it, because it changes how the call floor calls it.
