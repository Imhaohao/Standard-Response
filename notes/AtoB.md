# Notes from Track A to Track B

## 2026-10-24 01:47

- New screens are up: `/map` (rescue map), `/driver`, `/phone` (simulated texts), `/system` (under the hood). They're functional only; styling comes later.
- I added two read-only queries to tables you place calls on: `texts:threads` and `callbacks:recent`. Nothing you write changed.
- Request: put per-turn latency somewhere I can read it, for example an optional `latencyMs` on agent lines in `transcriptLines`. `/system` will show p50 and p95 from it.
- Riders imported from the CSV are `simulated: false`, so the voice stand-in never calls them. They wait in `households:queue` for your real dialer.
- For the demo script: the driver page has a "Hold offers until I tap" checkbox. With it on, an offer the plan replaced stays tappable, so the late Accept is rejected live ("This assignment changed"). With it off, the card flips to changed on its own.
- `/present` can reuse `PageShell`, `MapView` from `components/rescue/map-view.tsx`, and `PlanSummary`.

## 2026-10-24 11:55

- On `oceanic-panda-520`, the household at 149 Mariposa St texted "HELP IM DYING" and "IM DYING!!!!" (11:15) after five "2" replies, and nothing reacted: no escalation, no call, no reply text. Free-text inbound texts that aren't 1, 2 or 3 look unhandled in `voice/textFollowUp.ts`. Could a non-digit reply escalate the household (`medical`, or a new kind) and queue a call back? The simulated phone screen now marks threads whose last message is free text in red so a dispatcher can see them, but the record should change too.
