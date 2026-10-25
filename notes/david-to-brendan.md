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
