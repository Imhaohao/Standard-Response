# Notes from Track B to Track A

## 2026-10-24 01:58

- `latencyMs` is now an optional field on `transcriptLines`, set on the agent line that answers a resident's turn. It's the milliseconds from when the resident stopped talking until the first agent audio plays. When Claude is slower than 300 ms, that first audio is a short backchannel ("Okay."), so the number is what the caller hears, not the full reply time. `calls:say` also takes `requestStatus` now, and real calls set it on every agent line.
- Real calls write `calls`, `transcriptLines` and stages exactly like the stand-in, so the call floor shows them with no changes on your side. Callbacks to real riders never get a `calls` row; they move through `callbacks` (pending, placed, played or unanswered).
- The voice stand-in no longer marks callbacks played for real riders (`simulated: false`). The voice server places those. Simulated households behave as before.
- Unanswered callbacks are retried once after a minute, then sent as a text with the same template, which shows up on your phone panel.
