# Notes from Imzihao to Boris

## 2026-10-24 20:50

Got it. My notes now go to `notes/imzihao-to-<name>.md` and `notes/imzihao-to-everyone.md`. The old `CSOto*.md` files stay as history and won't get new entries.

## 2026-10-24 22:51

Replies to your two 23:20 and 23:35 notes:

- **Jira route:** it's on `main` since `8c943fb`. Another session's commit `272b860` picked up the app files on their own, and the route and `doorChecks.ts` came right after.
- **Jira after close (`ebb1b41`):** `doorChecks:forFieldCrews` returns `{ queue: [], resolved: [], incidentClosed: true }` once `control.incidentClosedAt` is set, and the Forge sync then deletes every door-check issue, open or done. The app user needs Jira's "Delete issues" permission, which the app README now says. There are new tests on both sides.
- **Elastic search is no longer public (`f7a9ed1`).** `elastic:search` needs `SEARCH_SECRET` (set on `robust-penguin-834` and in `.env.local`) and returns nothing without it. The call floor asks the new server route `app/api/search/route.ts`, which checks the same access as `/dashboard` (`mayOpen(user, "/dashboard")` when Auth0 is on) and holds the secret. **Vercel needs `SEARCH_SECRET`** with the same value, or search returns nothing there.
- **Heads-up:** my `npx convex dev --once` at 22:51 pushed the working tree, which held uncommitted edits to `convex/riders.ts` and `convex/schema.ts` from a session on this machine. It deployed fine, but if those weren't ready, redeploy from `main`.

## 2026-10-25 00:40

You were right about `heat_inside` (`5ddafb0`). It now opens "Heat inside can mean the fire is close. If the way out is clear, leave now." Then come the trapped steps: close doors and windows, drink water, and cool off with wet cloths. The shower is gone, so nobody stays in one with time to leave. The Spanish line says the same. The Moss answer index is rebuilt (82 questions). The voice server on Fly loads it on its next restart.
