# Notes from Boris to Imzihao

## 2026-10-24 21:30

We don't work in tracks any more, so please write new notes as `notes/imzihao-to-<name>.md` (or `notes/imzihao-to-everyone.md`) instead of `CSOtoB.md` and `CSOtoD.md`. B is Brendan and D is David. `AGENTS.md` describes the scheme, and `notes/boris-to-everyone.md` has the details, including the new `requests.party` field.

## 2026-10-24 23:20

Two things about the Elastic search:

- **Fixed: the purge now clears Elastic.** Closing the incident deleted real homes from Convex but left their household and transcript documents in Elastic Cloud, so the promise to delete everything when the incident closes didn't hold. Each purge batch now schedules `elastic:forgetHomes`, which runs `deleteByQuery` on those household ids (`forgetHouseholds` in `convex/elasticCore.ts`). `ElasticLike` gained `deleteByQuery`, and the test fake has it. Two new tests are in `tests/elastic`.
- **Still open: `elastic:search` is a public action.** Anyone with the Convex URL can search "oxygen" or "wheelchair" and get back addresses and transcript snippets of real people who can't get out, which is the at-risk list `PLAN.md` says we never expose. Until dispatcher auth exists, could it return only simulated homes, or require a server-side secret the call floor passes through a Next route? I haven't changed it, because it changes how the call floor calls it.

## 2026-10-24 23:35

The Jira door-check app:

- **Missing route.** `atlassian/door-checks/src/convex.js` calls `/agent/door-checks`, but `convex/http.ts` on `main` has no such route. `convex/doorCheckPayload.ts` is on `main`, but nothing imports it yet. Please push the route if it's still only on your machine.
- **Data left in Jira.** Once the route is live, Jira holds each home's address with "uses a wheelchair" or "medical equipment: oxygen". Today the app closes an issue when a home leaves the queue, but closing the incident leaves every issue in Jira. That breaks the delete-everything-at-close promise, just as Elastic did before 8903d38. Could the incident purge (or the app, once `control.incidentClosedAt` is set) delete those issues? The other option is sending Jira only simulated homes.

## 2026-10-25 00:10

Thanks for the Elastic gate and the Jira deletion. Both look right to me.

One worry about the new `heat_inside` answer in `voice/agent/approvedAnswers.ts`. On the night of a fire, "It's so hot in here" probably means the fire is close, not heat stroke on a summer day. The answer tells the caller to drink water and take a cool shower, but it never says to leave if they can. `smoke_inside` opens with "If smoke is coming in and the way out is clear, leave now." Could `heat_inside` open the same way, and fall back to the trapped steps if they can't get out? Otherwise someone might stay in the shower while they still had time to leave. I haven't changed it, because it's safety advice you sourced.

## 2026-10-25 03:05

Boris asked me to remove the one-fire-truck drill from the rescue map, so it's gone: `truck-drill-panel.tsx`, `truck-drill-layer.tsx` and `use-truck-drill.ts`. While a drill existed, `useDrillOnMap` also made the map's fire follow the drill's clock instead of the night's, so that override is gone too. `convex/truckDrill.ts` is untouched, in case you want the backend for something else.

Also gone at Boris's request: the "Start a fire" map tool (the lit-fire code stays, just with no way to light one), and the 2D map as a mode anyone can pick. The flat renderer is still the fallback when WebGL fails, and the phone mock-ups now draw the 3D map.
