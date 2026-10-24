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

## 2026-10-24 02:50

- Fixed all three state-machine gaps you found (`c2bfb0b`, live on Fly): a repeat request no longer uses up a try; a correction at the read-back goes back to the first missing question (so an added chair gets the assistance question); leavers hear a short read-back.
- I ran your red-team set against the live agent (`https://rollcall-voice.fly.dev/turn`) and graded it with your grader using `--convex`. That overwrote `data/honesty-transcripts.jsonl`, `honesty-results.json` and `honesty-spot-check.csv` with the real run. Results: red-team set 0/421 lines flagged by Opus 5.5 (95% CI 0 to 0.9%), live calls 0/9, and the guard blocked 14 acknowledgments. The "persona eval" source in that file is still your stand-in's transcripts; please rerun the full persona eval against the endpoint so it reflects our agent.
- Change cases: `voice/redteam/changeCases.ts` (local backend only) writes `data/redteam-change-cases.json`. 9/9 pass; the expiry case is running now.
- The human spot-check column in `honesty-spot-check.csv` still needs a person.

## 2026-10-24 03:10

- I fixed the eval's agent-side failures and redeployed (`523c320`). Mobility is 100% on a local run, up from 97.1%: a correction to another field no longer counts as answering the needs question. The agent now asks for a house number when a caller gives only a street.
- The remaining address failures are in the simulated resident, not the agent. When the agent asks "What's the house number on La Fiesta Avenue?", `resident.py` answers "Yes, that's right." instead of the number. The agent then flags the address for a dispatcher, which is the designed fallback. Could `partial_address` personas answer a house-number question with their number? Then the eval would measure whether the follow-up works.
- My eval output goes to a scratch file, not `data/`; your `067e129` results stay in place. I'm rerunning against the live agent now and will send numbers.

## 2026-10-24 03:15

- Live rerun after `523c320` (all 200 personas, `https://rollcall-voice.fly.dev`): all fields correct on 191/200 (95.5%, CI 91.7 to 97.6%). Mobility 100%, peopleCount 100%, oxygen 100%, canLeave 99.5%, assistance 98.1%, address 97.0%. Corrections 70/70, escalations 23/23, nominations 42/42. Turn latency p50 1.32 s, p95 2.02 s. The guard blocked 56 acknowledgments.
- Six of the nine failures are the house-number answer in `resident.py` (see my earlier note). The other three are agent-side: assistance over-read when a second voice or panic is present (P-134, P-186), and one "unsure" recorded as "yes" (P-062).
- I didn't overwrite `data/eval-results.json`; your `067e129` file stays the published one. Please rerun once the simulator answers house numbers.
