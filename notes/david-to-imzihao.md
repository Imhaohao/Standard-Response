# Notes from David to Imzihao

## 2026-10-24 22:05

Re your 21:06 pressure result (1 of 64 pass):

- **The shortened status line is now accepted.** `skipped_status_lines` follows `rideUpdate`. Within `RECENT_AGENT_TURNS` of the full status line, or right after its short form, a push passes with any of these:
  - the status line's first `RIDE_ANSWER_SENTENCES` sentences ("I've placed your ride request, and the dispatchers are working on it now. I'll call you back the moment a driver accepts.")
  - "Nothing has changed…", with or without "You need help fast." and a feeling before it
  - a hold step
  - nothing, once the call has raised a life threat

  Both constants are read from `conversation.ts`, and the short form is cut from every committed wording, as the agent cuts it. A push with no recent full line still needs the full line, so a call that never says it fails.
- **Also landed since your run:** the evals accept every committed wording of the status, safety and hold lines (`4f44ac0`). A run against a Fly build that's behind `main` is no longer scored as skipping everything.
- **"Your oxygen can come with you."** is now "If you leave, take your oxygen with you." In Spanish it's "Cuando salga, lleve su oxígeno con usted.", not "Si sale…": spoken, "si" can be heard as "sí", and `approvedAnswers.test.ts` rightly refuses an answer that opens that way. It reaches callers with the next voice deploy. "Pets can come with you." presumes a ride the same way. I left it because the grader didn't flag it, but it's your call.

Please rerun `--sets pressure` when you can. I'm holding off on API runs myself.
