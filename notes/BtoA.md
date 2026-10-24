# Notes from Track B to Track A

## 2026-10-24 01:58

- `latencyMs` is now an optional field on `transcriptLines`, set on the agent line that answers a resident's turn. It's the milliseconds from when the resident stopped talking until the first agent audio plays. When Claude is slower than 300 ms, that first audio is a short backchannel ("Okay."), so the number is what the caller hears, not the full reply time. `calls:say` also takes `requestStatus` now, and real calls set it on every agent line.
- Real calls write `calls`, `transcriptLines` and stages exactly like the stand-in, so the call floor shows them with no changes on your side. Callbacks to real riders never get a `calls` row; they move through `callbacks` (pending, placed, played or unanswered).
- The voice stand-in no longer marks callbacks played for real riders (`simulated: false`). The voice server places those. Simulated households behave as before.
- Unanswered callbacks are retried once after a minute, then sent as a text with the same template, which shows up on your phone panel.

## 2026-10-24 02:30

- The shared Convex deployment is `https://courteous-ptarmigan-590.convex.cloud` (in Jerry's team). I pushed `convex/` to it from `main` at `873daed`. Until now it had no functions. Put `CONVEX_DEPLOYMENT=dev:courteous-ptarmigan-590` and `NEXT_PUBLIC_CONVEX_URL` in your `.env.local`, and pull `main` before you run `npx convex dev`, because that command pushes your local copy of `convex/` over everyone's.
- The call server is live at `https://rollcall-voice.fly.dev`, and the team number +1 408 317 1482 rings it. The Twilio account is a trial: every call opens with Twilio's notice, outbound calls wait for a key press, and outbound calls only reach verified numbers.

## 2026-10-24 02:50

- `data/redteam-change-cases.json` holds the change cases for the under-the-hood screen: each case's checks, pass/fail, and the exact words the rider hears afterwards. `data/honesty-results.json` now reflects the live agent's red-team run (0 of 421 lines flagged).

## 2026-10-24 03:10

- Heads-up: someone (an agent?) has uncommitted Track A work in the clone at `~/Developer/CalHacks/calhacks`: the driver page split into `driver-map.tsx`, `offer-cards.tsx`, `ride-needs.tsx`, `run-list.tsx`, `stops.ts`, `ui/app-bar.tsx`, plus edits to `globals.css`, map files and `convex/offers.ts`. My pull briefly stashed it and hit conflicts with Boris's `6ed2d20`. I put every file back exactly as you had it, so nothing is lost, and `stash@{0}` still holds a copy. Note that your local `driver-page.tsx` and `convex/offers.ts` are based on an older `main`: committing them as-is would undo `6ed2d20` and the `riderFacts` change in `offers.ts`.
- I've stopped stashing in that folder. I only fast-forward now and commit just `voice/`.
