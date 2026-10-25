# Notes from Imzihao to everyone

## 2026-10-24 20:50

**Sponsor status (I'm running the sponsor loop).** What's load-bearing now, and what's blocked on a login:

| Sponsor | Where it carries weight | State |
| --- | --- | --- |
| Convex | Transactions behind every promise; reach ladder as a Workflow (`convex/reachLadder.ts`); Aggregate counts; HTTP action `POST /apify/zone-status` | Live on `robust-penguin-834` |
| Cartesia | Ink and Sonic on raw phone audio, barge-in, native voices in 8 languages, per-turn speed, volume and emotion by urgency (`voice/phone/delivery.ts`) | On `main`; reaches callers with the next `npm run deploy:voice` |
| Anthropic | Claude reads each turn and now words each question ("goals, not a script"); the Opus grader | On `main`. Pressure eval is 12 of 64: mostly the eval not knowing "Nothing has changed since I last told you", plus the waiting line "the dispatchers are working on it now", which the grader flags as implied help. Details in `CSOtoB.md` and `CSOtoD.md` |
| Apify | "California evacuation status" Actor (`apify/california-evacuation-status/`), webhook secret in `.env.local` and on Convex | Built; **needs `apify login` to publish** |
| Moss, Auth0, DigitalOcean | Already in the README sponsor table | Live |
| Figma (about $2K) | Pitch deck in Figma Slides plus a design log kept as you go | **Needs someone in Figma**; back-filled logs score zero |
| Twilio (not a sponsor) | Trial blocks outbound calls to unverified numbers and adds a key press | **Needs an upgrade**; the new rider homes (Boris, Hudson, Joseph, Brendan) also need `DIAL_ALLOWLIST` on Fly |

## 2026-10-24 21:32

**Apify Actor is on the platform** as `sangria_marzipan/california-evacuation-status` (Jerry's account, build 0.1.2). The first platform build failed: Apify requires a `title` on every nested input field, which local runs never checked, so I fixed `.actor/input_schema.json`. Live run `F2DreCsJmHesawsr4`: 202 records (9 zones, 2 incidents, 191 Caltrans closures), no source failed. The webhook pointed at `robust-penguin-834` sent 0 zones, because all 9 real zones are stale (the 8 Tulare orders date from 2023), and `apifyZones` on Convex is still empty, as it should be. It isn't listed in the Apify Store yet: that's a public listing under Jerry's name, so it waits for his OK. The README no longer calls it "public" until then.

## 2026-10-24 21:45

**Calls can run on Cartesia's telephony instead of Twilio.** `VOICE_CARRIER=cartesia` on the call server switches every call; `VOICE_CARRIER=twilio` (the default) switches back. Nothing else changes for anyone else.
- **How it works:** Cartesia answers and dials the phone (+1 850 641 7117), hears the resident and speaks. Our server still decides every word: Cartesia calls `POST /chats`, then opens `WS /ws`, and sends text events; `CallSession` answers through `voice/phone/cartesiaLine.ts`. The state machine, honesty rules, Convex writes and runners are the same code on both carriers.
- **The seam:** `CallSession` now talks to a `CallLine` (`voice/phone/line.ts`). `TwilioLine` wraps the old Twilio audio loop unchanged. `placeCall` and ringing hang-ups go through `voice/phone/carrier.ts`. `CallMode` and `StreamParameters` moved to `voice/phone/callParameters.ts`.
- **What Cartesia mode doesn't do yet:** answering-machine detection, urgency in the voice (speed, emotion), our own barge-in and phantom-speech filters (Cartesia's replace them). A no-answer counts as a miss 45 s after dialing. Helper transfer sends Cartesia's `transfer`; the docs say it needs a Twilio or SIP number, so on the Cartesia number it may fail.

## 2026-10-24 22:24

**The Apify Actor is public in the Apify Store:** https://apify.com/sangria_marzipan/california-evacuation-status (Jerry's account). Publishing needed an output schema (`.actor/output_schema.json`, build 0.1.3), a public profile and the Store terms. The README's Apify row links it. Opt into both Apify prizes on Devpost: best use and best Actor.

## 2026-10-24 22:26

**Devpost: opt into every one of these tracks** (submission closes 9:00am, so aim for 8:50). Each line is backed by code and can be pasted into the track's question box. Numbers come from the README; don't round them up.

| Track | Paste-ready line |
| --- | --- |
| Cal Hacks: Overall, People-First, Most Technically Complex, Hacker's Choice | (automatic, plus our main description) |
| Anthropic | Claude reads every turn of an evacuation call in ten languages and words each question; code owns every promise about a ride, and Claude Opus grades every agent line for implied help before we ship. |
| Convex ($5K) | One Convex database is the whole system: transactions guard every promise a rider hears, the retry ladder is a durable Workflow, counts come from the Aggregate component, an HTTP action takes Apify zone alerts, and the voice server runs on live subscriptions. |
| Cartesia | Ink and Sonic carry every call on raw phone audio in ten native voices, with barge-in, an apology after cutting someone off, urgency-based speed and volume, and Cartesia telephony as a second carrier. |
| Moss | Moss gives the agent the agency's approved answers: 62 of 66 caller questions answered right with Moss, 12 of 66 without. |
| Apify: best use, and best Actor | Our public Actor "California evacuation status" (apify.com/sangria_marzipan/california-evacuation-status) normalizes CA evacuation zones and Caltrans closures and starts Rider Check when a zone with riders goes to warning. |
| Microsoft: Built for the Real World, and Customer Impact | Built with firefighters and battalion officers; human-approved dispatch, honest status lines, measured evals, data deleted when the incident closes. |
| MLH: Auth0 | Dispatcher login with role-gated access to the at-risk list and step-up auth on the first ride approval. |
| MLH: DigitalOcean | The OR-Tools dispatch solver runs on DigitalOcean App Platform. |
| MLH: Gen AI | Claude (Anthropic) powers the voice agent. |
| MLH: Commit Fellowship | Opt in, then fill in MLH's extra form. |
| MLH: .tech / GoDaddy domain | Only if someone registers a domain before submitting. |
| Meta: Bringing People Closer Together | The agent asks every caller "Is there anyone else on your street who might not be able to leave?", so neighbors find each other, and a neighbor who can drive is matched as the ride. |
| Figma | Only if the deck is built in Figma Slides with a design log. Otherwise skip. |

Skip: Hyphenate, Visa, Coinbase, CRS, Capital One (finance or shopping only), SpacetimeDB (it would replace Convex), ElevenLabs (it competes with Cartesia, unless the ElevenLabs stack is demoed), Atlassian (needs Forge), Bright Data, Fetch.ai, CREAO, Mana, Factory.

Also: the README says live calls run "Claude Opus 5.5 in fast mode", but `voice/env.ts` defaults to Haiku 5.5. Whoever knows Fly's `VOICE_MODEL`, make the README match it.

## 2026-10-24 22:40

Neighbors named on a call can now be found by name, and a neighbor in danger goes straight to a dispatcher.

- `nominations:add` takes an optional `danger: boolean`. Old callers still work. When the spoken text names exactly one resident on file ("Boris, bedridden"), the nomination is saved as `matched` to that home right away. With `danger`, that home is escalated `medical`. With `danger` and no match, it goes to `nominations:flagged` with the note "in danger now, near <caller's address>".
- New `voice:neighborNames({ householdId })` returns the other residents' names only. The agent uses it to say "Thanks, I've passed on Boris Nezlobin." instead of asking for an address the caller doesn't know.
- The interpreter keeps `emergency` for people in the caller's home. A neighbor who is dying sets the new `neighbor_danger` field instead, so the caller is no longer marked urgent for someone else.
- Name matching lives in `lib/name-on-file.ts`: a first or last name as a whole word, and two people who both fit means no match.

## 2026-10-24 22:45

The call floor moved from `/` to `/dashboard`, still dispatcher-only.

- `lib/access.ts` gates `/dashboard` with the dispatcher role and no longer gates `/`. The app bar's "Call floor" link, the README and HANDOFF point at `/dashboard`.
- `/` is becoming the public sign-in page for judges. Until it lands, `app/page.tsx` only redirects to `/dashboard`, so old bookmarks still work.
- Auth0 logins started without a `returnTo` land on `/`. The proxy always sends one for gated screens, so nothing changes there.

## 2026-10-24 22:56

**More sponsors are now load-bearing on `main`. Add these to the Devpost checklist above:**

| Track | Paste-ready line | Needs before the demo |
| --- | --- | --- |
| MLH: Gemini API | Gemini independently re-grades every agent line Claude's grader judged, and we report the agreement (Cohen's kappa) so no single model grades its own family. | `GEMINI_API_KEY`, then `grade_honesty.py --second-grader gemini` |
| Bright Data | CAL FIRE's own incident site blocks plain requests (403 from Akamai); Bright Data Web Unlocker lets the Actor read it. | Web Unlocker zone and key in the Actor input |
| Fetch.ai | A uAgent on Agentverse lets a caregiver, or anyone's agent on ASI:One, sign a relative up for the Ready check and ask whether a warning is active, without exposing anyone's data. | Run `fetchai/`, connect the mailbox, and register through ASI:One's submission agent |
| Factory | After the voice exam fails, a sandboxed Droid diagnoses each failed case and proposes a tested diff; it can't touch the repo. | `FACTORY_API_KEY` and the `droid` CLI |
| Elastic | Dispatchers search every call by what people said ("oxygen", "second floor") in any language, through a dispatcher-gated route. | Elastic Cloud serverless URL and key on Convex, plus `SEARCH_SECRET` on Vercel |
| Bitdeer AI | If Claude is down or slow mid-call, the agent answers on a Bitdeer-hosted model, still behind the honesty guard. | `BITDEER_API_KEY` locally and on Fly |
| Atlassian | A Forge app turns every unreached home into a Jira work item for field crews and deletes them all when the incident closes. | `forge deploy` and install on a Jira site |
| Capital One Nessie | Volunteer neighbors who drive someone out get mileage paid (IRS charitable rate) through Nessie, exactly once per confirmed pickup. | Nessie key and agency account id on Convex |

Also new: closing the incident deletes real rider data everywhere (Convex, Elastic, Jira, payment records) after a 72-hour window (Convex scheduler and a daily cron). That line is for Microsoft's responsible-design question.

## 2026-10-24 23:01

**Real phones on houses: one shared path, and a list on the call floor.**
- **Contract:** `riders:setPhone({ householdId, phone, residentName? })` keeps its signature, and the new `riders:clearPhone({ householdId })` takes a real number off. Both go through `putRealNumber` / `takeRealNumberOff` in `convex/riders.ts`, the only code that should put a real number on a house or take one off. CDO's claim flow: call these instead of patching `callbackNumber`.
- **What's kept:** when a real number replaces a fictional (555-exchange) one, the house's old number, name and `simulated` flag go in the new optional `households.standIn`. Taking the number off restores them exactly. A house made for one person (no stand-in) gets a placeholder `+16265559xxx` and becomes simulated. Any number change resets the house's call queue.
- **Call floor:** "Real phones" in the bar (`components/floor/demo-numbers.tsx`) lists the team's phones (`demoNumbers` table, `convex/demoNumbers.ts`). Each one shows its house and can be put on, moved or taken off. Only a house with a fictional number can take one, so a real number is never overwritten. The list survives `control:reset`, and "Put N numbers back on their houses" puts each number back by address. The six team numbers on Olive Avenue are already in the list.
- **Not changed:** the voice server still dials only numbers in Fly's `DIAL_ALLOWLIST`, so a phone added to the list rings only once it's in that list.

## 2026-10-24 23:10

**`/` is now the judges' kiosk, and judges' own numbers go on houses.** This replaces PLAN.md's "never enter a judge's own number": Imzihao decided judges sign in with their real phone.

- **Flow:** a judge types their number on the big screen, or scans the QR, which opens `/join?k=<code>` on their phone (`type="tel" autocomplete="tel"`, so the phone offers its own number). The kiosk advances by itself. They tap an open house, edit the resident (name, language, people, can leave, mobility, help, medical, pets, car), and press "Take this house". The kiosk resets for the next judge after 9 seconds. `/` and `/join` need no role.
- **New tables (schema, additive):** `kioskSessions` (one per sign-in: `code`, `phone`, `householdId` once claimed) and `claims` (`householdId`, `phone`, `claimedAt`, and the house's record before the claim). `households` is unchanged.
- **New functions, `convex/claims.ts`:** `startKiosk`, `session({ code })` (returns only the last four digits), `submitPhone({ code, phone })`, `homes` (demo houses only: houses with a fictional 555 number, plus judges' houses; any other real number is left out), `draft({ householdId })`, `claim({ code, householdId, record })` and `clearAll`.
- **What a claimed house is:** `claim` checks and writes in one transaction. The house must have a fictional number, no claim, not be on a call, and have no open ride request. Then it calls `putRealNumber`. The house becomes `simulated: false` with the judge's number and a fresh call queue (`not_called`), and its stand-in is kept. `voice:dialQueue` and `ready:queue` list it, and the stand-in skips it. **Nothing calls on submit.** The real voice server rings the judge when the Ready check runs or a warning covers the house, and only if Fly's `DIAL_ALLOWLIST` is `*` or includes the judge's number. With the voice stand-in on and no voice server, the rescue map lists the house as "never called".
- **Judges' numbers are stored** in `households.callbackNumber`, `claims.phone` and `kioskSessions.phone`. Run `npx convex run claims:clearAll` after the event or between rounds. It takes each number off with `takeRealNumberOff`, puts back the house's old record, and deletes every claim and kiosk sign-in. A house on a live call is skipped, so run it again once that call ends. Two copies outlast it: night archives (`nightRunRows`) saved while a judge held a house, and houses the incident purge deleted (their claim rows are removed by `clearAll`).
- **Limits on the public mutations:** 120 sign-ins per 10 minutes, 6 number tries per sign-in, sign-ins expire after 20 minutes, 80 claims at most, one house per phone, names up to 60 characters, 1 to 12 people, English or Spanish.

## 2026-10-24 23:20

**The voice server now rings any real number.** Fly's `DIAL_ALLOWLIST` is `*`, so a phone added in "Real phones" or by a judge rings with no Fly change. `mayDial` (`voice/env.ts`) still never dials a 555-exchange number, even under `*`, so the 40 sample riders and the seeded town stay undialed. To go back to a fixed list, set `DIAL_ALLOWLIST` on Fly to comma-separated numbers again.

## 2026-10-24 23:58

**Live checks with real keys:**
- **Capital One Nessie, live.** Agency account created with $5,000 of sandbox money; `NESSIE_API_KEY` and `NESSIE_AGENCY_ACCOUNT_ID` are set on `robust-penguin-834`. The live sandbox differs from the old SDKs: plain http doesn't answer, a transfer has no payee field, and amounts are whole dollars. So a payment is a transfer out plus a deposit in, rounded up to the dollar (`dae84c5`). A real 7-mile payout ($1) went through our client end to end.
- **Bitdeer, live.** The default model thought before answering and returned empty JSON; it's now Qwen3.8-27B with thinking off (about 0.5 s) and an explicit user agent, since Bitdeer's firewall 403s Python's default one (`50d6a71`). Outage drill with Claude unreachable: Bitdeer answered every turn, and a ride question still got only the fixed status line. **Fly needs `BITDEER_API_KEY`** for this to work on real calls.
- **Bright Data:** the key works, but the account has no zone yet. Create a Web Unlocker zone, then set `BRIGHTDATA_ZONE`.
- **Factory:** the key is in `.env.local`; the `droid` CLI isn't installed on this Mac yet.
- **Not yet received:** Gemini, Elastic and Agentverse keys.

## 2026-10-25 00:15

**ElevenLabs is now a real Devpost entry (MLH: Best use of ElevenLabs).** The key works live. Creating a per-call agent takes 1.5 s, and sample speech starts in 0.4 s. The README has a row for it.
- **Paste for MLH ElevenLabs:** "Every evacuation call can run on ElevenLabs Conversational AI. Each call gets its own agent built from that household's file, and its client tools write the resident's answers straight into our Convex record, so a whole carrier outage is one setting away from a working phone line."
- **Paste for Armadin, Best Security Hack:** "A phone agent for evacuations is an attack surface: anyone can call it and say anything. We red-team it with spoken prompt injection and pressure attacks graded by two model families. Ride promises are fixed code templates the model can't write. Dispatcher data sits behind Auth0 roles and step-up auth. Every phone number, transcript, Jira issue and payment record is deleted when the incident closes."
- To demo it, set `VOICE_STACK=elevenlabs` on Fly for one call. Leave it on Cartesia for the main demo.
