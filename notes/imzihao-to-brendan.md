# Notes from Imzihao to Brendan

## 2026-10-24 21:50

Sponsor pass on `/present` (`d1ebe8b`). The deck reads great. Cartesia, Claude and Convex each get a scene. Suggestions, all yours to take or leave:

1. **"Cartesia's Ink model listens to Roseland in 8 languages":** it's **10** now. French and Hindi landed in `ae0f833`, each with a native Sonic voice (`64da657`). Check that `scenes/voice/languages.ts` shows 10 too.
2. **Moss and Apify are sponsor tracks with real money and don't appear in the deck.** Each is one beat:
   - Moss, after the "protocol" beat: "When Roseland asks a question we can't improvise, like 'Can I bring my oxygen?', Moss finds the agency's approved answer in milliseconds: 62 of 66 questions answered right with Moss, 12 of 66 without." (David's measurement, in the README.)
   - Apify, before the "zone" beat: "When the state posts a new warning zone, our Apify Actor sees it and starts the calls; nobody has to draw it." The Actor is live on the Apify platform (run `F2DreCsJmHesawsr4`, 202 records). A drill run makes this a live demo moment.
3. **"Claude's Haiku and Opus models... makes every reply aligned with real 911 protocols":** "every" is a claim a judge can test. The Opus grader flags about 1.5% of Claude's own words under pressure. Safer: "...and code checks every reply against real 911 protocols before the caller hears it." That's also the stronger Anthropic-track story: Claude interprets, code commits, Opus measures.
4. **Model check:** the README says live calls run "Claude Opus 5.5 in fast mode", but `voice/env.ts` defaults to Haiku 5.5 (`VOICE_MODEL`). The deck says Haiku. Whatever Fly actually runs, make the README and the deck match it.

## 2026-10-25 03:40

I changed four sponsor rows in your README rewrite so they don't claim more than has run, following your Gemini row:
- **Elastic, Fetch.ai and Bright Data** now start "Built, not yet run" and say what's missing: no Elastic key, no Agentverse mailbox, no Web Unlocker zone.
- **Elastic** had an out-of-date line saying search is public. It's dispatcher-only: `/api/search` checks the Auth0 session, and the Convex action refuses calls without `SEARCH_SECRET`.
- **Atlassian** now says it deletes every issue when the incident closes, and that it isn't deployed to a Jira site yet.

If a key arrives and one of these runs live, drop its "not yet run".

## 2026-10-25 04:41

Voice confirmations now read back only a correction after the first summary, without repeating the unchanged needs or an already confirmed address. Corrections on hold are checked and return to hold without asking about neighbors again. One answer that supplies head count and mobility skips the already answered needs question. Unchanged ride status no longer expires from call memory after three turns; a new assignment, ETA or revocation still gets its full status line, and an explicit repeat request still works.

`Lines` adds `noPets`, `noMedical`, `dialysis` and `otherMedical` in all ten languages so removed needs can be checked explicitly. The non-English additions have not had a fluent-speaker review. No Convex contract or pickup hand-off change. Voice tests, typecheck and complexity lint pass. This is a code change; the voice server still needs its normal deployment.
