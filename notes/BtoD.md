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

## 2026-10-24 13:52

What changes for the persona eval and the honesty grader (all through `POST /turn`):

- **A new Claude-written sentence.** When the resident asks something that isn't an answer ("why do you need that?", "who is this?"), the reply can include one sentence of Claude's (`reply` in the interpreter). It goes through `guardAcknowledgment` like the acknowledgment and is dropped, not replaced, when blocked, so `guardBlocked` covers it. Please include these lines in the honesty grading.
- **Re-asks use other words.** After an answer that doesn't answer, the agent asks again with `askAgain.*` instead of the same question, so a check that looks for the exact question template will miss them. "What?" still gets the question word for word.
- **Tries.** A turn where the resident asks something back, or asks for a moment ("hold on, let me ask my wife": the reply is `takeYourTime` with no question), no longer uses up a try or counts toward the `language_barrier` hand-off.
- **Neighbor question.** "Yes, there is someone" with no address gets asked for the address once.
- Phone-only, not in `/turn`: quiet check-ins after 7 seconds of silence (after three, the call ends as unanswered and the reach ladder calls back), and corrections after the goodbye reopen the call.
- Not yet deployed to Fly. I'll write here once it is.

## 2026-10-24 14:40

What changes for the persona eval and the honesty grader (all through `POST /turn`):

- **The acknowledgment can be an echo.** When an answer changes a record field, the turn's `acknowledgment` is a template echo of those fields ("2 people, with pets.") instead of Claude's words, in every language, and `acknowledgmentIsEcho` is true. It comes from `Lines`, so it can contain a digit; please don't grade those digits as an invented number.
- **Hand-off wording.** `languageBarrier` now says a person on our team was told about the call, not that the call is being passed to one, and plays in the call language plus English (it used to play up to three languages).
- **Interpreter prompt.** Claude now gets a short set of call-taker principles and the call stage with its goal. Answers to "are you a robot?" now say it is the line's automated assistant.
- Phone-only: transcripts that look like speech-to-text inventing words from silence ("Thank you.", "감사합니다.", a looped word) are dropped when the audio behind them carried almost no voice.

## 2026-10-24 16:40

The voice exam (`npm run exam:voice`, README "Voice exam") drove changes to lines your resident simulator matches (`modeling/rollcall_d/resident.py` `QUESTION_PATTERNS`):

- New needs line when mobility was already heard on the call: "Does anyone there need oxygen?" / "¿Alguien ahí necesita oxígeno?". It has no pattern yet, so `classify` returns `unknown`; it belongs under `needs`.
- New household line when pets are already known: "How many people are with you right now?" (still matches `how many people`).
- `askHousehold` and `askNeedsOnFile` are now two sentences ("... right now? Are there any pets?", "Is that still right? Does anyone need oxygen?"); your patterns still match.
- The inbound greeting no longer says "I can help get you a ride out", and `askAgain.address` no longer starts with "Sorry, I didn't catch that." (still matches `street address`).
- A bare "yes", "no", "just me", "okay" on hold or "hello?" is now read in code without Claude (`voice/agent/quickAnswer.ts`), so those turns return in milliseconds over `POST /turn`.
- `POST /turn` request and response shapes are unchanged.
