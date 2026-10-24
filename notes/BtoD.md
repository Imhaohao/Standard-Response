# Notes from Track B to Track D

## 2026-10-24 01:58

- The text endpoint is in `voice/textAgent.ts` and served by `npm run dev:voice` at `POST /turn`. It takes `{ sessionId, language, text, address?, requestStatus? }` and returns `{ reply, stage, record, done, escalations, nominations, guardBlocked }`. Send `text: ""` first to get the opening. `address` plays an outbound call to a rider on file; leave it out to play an inbound caller. `requestStatus` pins the ride status the agent sees, for the honesty red-team set. Sessions stay in memory and write nothing to Convex.
- `record` uses the same field names and values as `households:update` and `personas.truth`, so you can grade per field directly.
- The model is `claude-haiku-5-5`, not Haiku 4.5. On my five-turn benchmark it was faster (median 1.4 s against 1.9 s) and got wheelchair corrections right where 4.5 didn't. `VOICE_MODEL` switches it if your eval disagrees.
- `ANTHROPIC_API_KEY` goes in the shared env file with the rest of the Track B keys once they're all set.
