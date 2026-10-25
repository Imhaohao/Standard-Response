# Notes from David to Brendan

## 2026-10-24 20:05

Moss now answers the dangerous questions on calls, in your `voice/agent/approvedAnswers.ts` and the interpreter prompt. Review it, and change anything that fights your design.

- **Three safety answers in the bank,** in English and Spanish:
  - `go_back_inside`: "Don't go back inside, not for a pet or for anything else. Get yourself out now."
  - `go_get_someone`: "Don't go back for them. Get yourself out now. If you tell me their address, I'll pass it to the dispatcher."
  - `medical_change`: "I can't give advice about medicine or oxygen. For trouble breathing, call 911."
  - These follow what Palo Alto Station 6 told us: state the risk, tell them to leave, and never say "leave her."
- **Code decides which answers a question may get** (`mayGetApprovedAnswer(question, id)`). A question about going back or going to get someone gets only one of the first two. A dose or oxygen change gets only the third. An ordinary question never gets a safety answer. Staying or waiting gets none, because the ride status line answers it.
- **Claude's own words on a dangerous question are never spoken.** Without a safety answer, `reply` is empty. In a live check with Moss off, Claude answered "¿Voy por mi vecina?" with "Anotamos a su vecina, pero no vaya a buscarla todavía.", and the guard let it through.
- **The `policy_question` prompt** now also covers going back and dose or oxygen changes. Checked live on 9 questions (en and es): every one landed on the right kind.
- **Guard note, not changed:** the Spanish `horas?` pattern has no word boundary, so any acknowledgment containing "ahora" is blocked. The Spanish answers say "de inmediato" for that reason.
- **Needs Moss keys (I don't have them):**
  - `npm run moss:index` rebuilds the answer index with the new questions. Until then Moss can't match the three safety answers, and those questions get no reply.
  - `npm run moss:check` then writes `data/moss-answer-check.json`. It sends 22 questions through the live interpreter and answers each with Moss and without, which is the number for the Moss prize.
  - Then deploy to Fly so calls get it.

## 2026-10-24 21:40

Moss measured, and the dialog bank grown. Both indexes are rebuilt in the shared Moss project, so Fly picks them up on its next restart.

- **`npm run moss:check -- --runs 3`** (`data/moss-answer-check.json`): 22 questions, each read 3 times by the live interpreter, answered with Moss and without.
  - With Moss: 62/66 correct, 50/54 approved answers, 15/18 safety answers, 0 ordinary answers on a dangerous question.
  - Without Moss: 12/66. Those are the 4 questions that must get no answer. 0 approved answers and 0 safety answers.
  - Median Moss lookup: 5 ms. On a miss, Claude says "No sé eso. Consulte a su médico o farmacéutico."
- **The guidance was hurting before this.** The 15-script pilot bank had no caller who asks anything, so with guidance on, "¿Cuántas pastillas del corazón me tomo?" was read as a policy question 0 of 4 times, and once as "Can I bring my cat?". With guidance off it was 4 of 4. Three fixes:
  - the guidance header says moments show how to read answers;
  - four question-asking twists added to `voice/knowledge/seeds.ts`;
  - the bank grown, with checked moments where callers ask these questions.
  It's now right 4 of 4 with the new moments, and 2 of 4 after the prompt example below. Claude's reading varies, so `--runs 3` is the number to trust.
- **The interpreter prompt** has a Spanish example: "¿Voy por mi vecina?" is "Should I go get my neighbor?". That case went from 1 of 4 to 4 of 4.
- **`npm run knowledge:generate -- scripts 135` is still running** on my machine and appending to `data/moss/dialog-bank.jsonl`. I'll commit and re-index again when it finishes.

## 2026-10-24 22:50

The proof slide's spoken line and its on-screen numbers come from different rows of `data/eaton/night-sim-results.json` (median of 5 runs, 662 at-risk homes):

| Row | Today's process | With Standard Response |
| --- | --- | --- |
| Calls from 10:50 p.m., 25 vans (what `night-outcome.ts` shows) | 39, **5.9%** | 641, **96.8%** |
| Calls from 3:25 a.m., 25 vans | 29, **4.4%** | 228, **34.4%** |

`cues.json` says "only 4% … got out in time" (the 3:25 row) and then "97% did" (the 10:50 row), while the screen shows 39 and 641 (both from the 10:50 row). A judge who does the division gets 6%, not 4%. Either say "only 6%" to match the screen, or put the 3:25 row on screen and say "4%" and "34%". The like-for-like pair is the honest one, and PLAN.md's proof standard asks for it. I haven't changed either file, since the script is yours.

Separately, `data/eaton/replay-results.json` now counts 1,262 west-side households needing a ride, down from 1,601. Walker users who can leave by car were counted by mistake; see `notes/DtoA.md` at 20:05. The night sim already uses the corrected count, so 662 at-risk homes is right.

## 2026-10-24 23:45

Thanks, the proof slide now matches what's said: 29 of 662 (4%) and 642 of 662 (97%), each labeled with its setup. One thing a judge may catch: the two sides also differ in fleet, 25 vans for today and 50 for ours. At 50 vans, today's process at 3:25 a.m. gets 43 of 662 (6%). Either use 50 vans on both sides (6% against 97%), or say "the same 25 vans from 10:50 p.m. get 641" (97% either way). That keeps the gap down to when the calls start, which is our claim.

## 2026-10-25 02:50

The bank generation finished at 60 scripts (7 checked question moments). Both Moss indexes are re-uploaded (340 dialog moments). `moss:check -- --runs 3` on the final bank: with Moss 63/66 correct, 51/54 approved answers, 16/18 safety answers, 0 ordinary answers on a dangerous question. Without Moss: 12/66. The check now runs 2 questions at a time and retries a question after a dropped connection; at 4 at a time, this connection kept dropping requests.

## 2026-10-25 05:31

The Moss number changed after Imzihao's recall rework: with Moss, **61 of 66** questions get the right answer (was 63), including **14 of 18** safety answers (was 16). Without Moss it's 12 of 66, and still no dangerous question gets an ordinary answer. The README is updated. If the Devpost text or the Moss pitch line says 63 or 16, please change it to match.
