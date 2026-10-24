# Notes from Track D to Track B

## 2026-10-24 02:20

- Nothing changes for you. Keep writing spoken addresses to `nominations:add` as heard ("the yellow house next door, 2611 Lincoln"). Track D's runner matches them against existing households first, then OSM address points, and resolves them. A nominated address that isn't on the rider list becomes a door-check household with no phone.
- Unlocated inbound callers: once you write the caller's spoken address with `households:update` (patch `address`), D matches it and calls `households:setLocation`, which also clears `address_unconfirmed`. If the match is ambiguous it stays flagged.
- `data/personas.json` is coming next, with a `correction` on many cards, for your tests.

## 2026-10-24 02:45

- `data/personas.json` has landed: 200 cards. Each has `truth` (the same shape as the `personas` table and your `record`), `language`, `direction` (outbound = rider on file, with `address` and `onFile`; inbound = unknown caller), `traits` (hard_of_hearing, partial_address, panic, tangents, second_voice, asks_reassurance, flames, medical, nominates_neighbor) and, on 108 cards, `correction` = `{ field, firstSays, when }` with `when` one of `next_turn`, `readback`, `second_voice`. `card` is the plain-language version to hand a tester.
- P-001 is Carmen from the demo script and P-002 is Walter; both match `data/sample-riders.csv`.
- Thanks for the `/turn` notes. My eval sends `address` for outbound cards and `requestStatus` only in the honesty set. I'll report anything odd here.

## 2026-10-24 03:20

Two state-machine gaps the persona eval found. I hit both in my scripted stand-in agent, which copies your steps from `voice/agent/conversation.ts`, so I believe yours has them too:

1. **A repeat request counts as a failed try.** `hear()` returns `{ step: this.step }` for `wantsRepeat`, and `moveTo` then increments `triesOnStep`. A hard-of-hearing caller who says "sorry, what?" twice on the address step gets `address_unconfirmed` escalated without ever being asked again properly; on the needs step, mobility is skipped. Suggested fix: don't increment `triesOnStep` when `wantsRepeat` is true.
2. **A correction at the read-back that adds a mobility aid never asks the assistance question.** `readback()` goes `readback → readback` when `changedThisTurn`. If the correction makes `hasLimitedMobility` true while `assistanceRequired` is undefined, the record ships without assistance (it's the second-voice case: "Mom, tell them about my chair"). Suggested fix: after a changing turn in `readback`/`fix`, go to `assistance` when `hasLimitedMobility(record) && record.assistanceRequired === undefined`.

The eval harness: `cd modeling && uv run python scripts/eval_personas.py --endpoint <your /turn base URL>`. Without `--endpoint` it runs my scripted stand-in, which only proves the harness works. If your Fly.io deployment serves `/turn` at a public URL, please put it in a note and I'll run the real eval and the honesty set against it.

## 2026-10-24 03:50

- Red-team set: `uv run python scripts/eval_personas.py --endpoint <url> --honesty` runs 25 reassurance-seeking callers against your `/turn`, each twice, with `requestStatus` pinned to `received` and then `reassigning`. Then `uv run python scripts/grade_honesty.py --convex` grades every agent line (with templates removed) using a separate Claude grader plus a lexical floor, including your live `transcriptLines` by `requestStatus`. It writes a spot-check CSV for the human pass.

## 2026-10-24 04:30

- Personas are now drawn from the synthetic population (70% from households that need help). Third finding from the eval: **residents who say they can leave never hear a read-back**, so a mistaken "yes, I can get out" can't be corrected. `afterCanLeave()` goes straight to `neighbor` when `needsRide` is false. In the eval, a resident who says "yes" and only realizes at the read-back ("actually my husband's chair won't fit") never gets the chance; that's most of the 7% correction failures. A short read-back for leavers ("You're leaving on your own by car. Is that right?") would catch it. Your call.

## 2026-10-24 06:10

- Thanks for c2bfb0b. My scripted stand-in now mirrors all three fixes (repeats don't use a try, `nextMissing` after a correction, the leaver read-back), and the simulated residents correct a wrong can-leave at the read-back. The harness is ready to run against `https://rollcall-voice.fly.dev/turn` when we choose; I'm holding the real run until the team says go.
