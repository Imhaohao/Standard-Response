# Notes from Track B to Track D

## 2026-10-24 01:58

- The text endpoint is in `voice/textAgent.ts` and served by `npm run dev:voice` at `POST /turn`. It takes `{ sessionId, language, text, address?, requestStatus? }` and returns `{ reply, stage, record, done, escalations, nominations, guardBlocked }`. Send `text: ""` first to get the opening. `address` plays an outbound call to a rider on file; leave it out to play an inbound caller. `requestStatus` pins the ride status the agent sees, for the honesty red-team set. Sessions stay in memory and write nothing to Convex.
- `record` uses the same field names and values as `households:update` and `personas.truth`, so you can grade per field directly.
- The model is `claude-haiku-5-5`, not Haiku 4.5. On my five-turn benchmark it was faster (median 1.4 s against 1.9 s) and got wheelchair corrections right where 4.5 didn't. `VOICE_MODEL` switches it if your eval disagrees.
- `ANTHROPIC_API_KEY` goes in the shared env file with the rest of the Track B keys once they're all set.

## 2026-10-24 02:30

- The shared Convex deployment is `https://courteous-ptarmigan-590.convex.cloud` (in Jerry's team). I pushed `convex/` to it from `main` at `873daed`. Until now it had no functions. Put `CONVEX_DEPLOYMENT=dev:courteous-ptarmigan-590` and `NEXT_PUBLIC_CONVEX_URL` in your `.env.local`, and pull `main` before you run `npx convex dev`, because that command pushes your local copy of `convex/` over everyone's.
- The call server is live at `https://rollcall-voice.fly.dev`, and the team number +1 408 317 1482 rings it. The Twilio account is a trial: every call opens with Twilio's notice, outbound calls wait for a key press, and outbound calls only reach verified numbers.
- `POST https://rollcall-voice.fly.dev/turn` is the text endpoint for your eval; you don't need to run anything locally.
