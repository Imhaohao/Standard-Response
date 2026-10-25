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
| MLH: DigitalOcean | Our dispatch solver, an adaptive large neighborhood search (ALNS) with OR-Tools and a greedy heuristic as baselines, runs on DigitalOcean App Platform. |
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
- **Paste for Armadin, Best Security Hack:** "A phone agent for evacuations is an attack surface: anyone can call it and say anything. We red-team it with spoken prompt injection and pressure attacks, graded by Claude Opus 5.5 against a written rubric. Ride promises are fixed code templates the model can't write. Dispatcher data sits behind Auth0 roles and step-up auth. Every phone number, transcript, Jira issue and payment record is deleted when the incident closes."
- To demo it, set `VOICE_STACK=elevenlabs` on Fly for one call. Leave it on Cartesia for the main demo.

## 2026-10-25 00:10

**Real phones: each person has an on/off switch.** Off takes the number off its house (`takeRealNumberOff`) so nobody calls it, and the row remembers the house; on puts it back there (`putRealNumber`). It replaces "Take off". Contract: `demoNumbers:takeOff` is gone, and `demoNumbers:setOn({ numberId, on })` and `demoNumbers.paused` (optional) are new. "Put numbers back" skips numbers that are off. Judges' numbers (any phone in `claims`) are never pulled into the list, so the kiosk and `claims:clearAll` stay their only owner.

## 2026-10-25 00:30

**Correction to the 00:15 Armadin paste:** it now says Claude Opus 5.5 grades the red-team, not two model families. The Gemini second grader hasn't run yet, because no key has arrived. Thanks, David. Put Gemini back in only after a run with the key is committed.

## 2026-10-25 01:10

**The app bar: three screens, a Tools menu, and Restart.**
- **Nav:** Call floor, Rescue map and Driver page stay as pills. Under the hood, Simulated phone, Ready sign-up, Mesh and flow, Readiness survey and Judge sign-in (`/`) moved into "Tools". On one of those pages the button reads "Tools: <page>". New screens go in `SCREENS` or `TOOLS` in `components/ui/app-bar.tsx`.
- **Restart:** the three end-night buttons moved out of the call floor's Simulation settings into a "Restart" menu on the right of the app bar, on every screen that has the bar (`components/control/restart-menu.tsx`). "Rewind to before the warning" is first. Each still takes two clicks, still shows the server's refusal ("A real call is still live..."), and now confirms when it's done. It shows while Auth0 is off, or to a signed-in dispatcher, and never on `/`, `/join` or `/ready`. No Convex change: it calls `control:rewind` and `control:reset` as before.
- **For other popovers:** `usePopover` (`components/ui/use-popover.ts`) adds focus return on Escape, close on Tab out, and arrow keys over `useDismiss`. `Button` now takes a `ref`.

## 2026-10-25 00:13

**Voice: "nobody's home" is confirmed before a ride is called off.** The voice exam caught Haiku flagging "we just walked outside" and "I'm in the car, he's at our house" as nobody home, and the agent then said "I've marked you as safe" and hung up. Now an `away_from_home` reading asks `confirmAway` ("Just to be sure, is anyone at the home right now, even someone who can't come to the phone?"); only a no marks the home away, and a yes or two unclear answers resume the call. New step `confirm_away` (stage `confirm_address`), so POST /turn can return `step: "confirm_away"`. `awaySafe` no longer says "safe" or "evacuation orders", and `needAddress` no longer says "rescue list" (the exam judge read both as implied promises), in all 10 languages.
- **Ride questions:** straight after the full status line, a ride question now hears its first sentences (`rideAnswer`), not "Nothing has changed". "Nothing has changed" only follows the short answer. The voice exam's ride check now accepts exactly that, as the pressure eval already did.
- **canLeave:** "unsure" never replaces a recorded "no" (the code now enforces the prompt rule).

## 2026-10-25 00:34

**Rescue map: a one-fire-truck drill.** New "One fire truck" panel on the rescue map (right column). "Send one truck" sends one engine from Station 12 at the warning to pick up everyone in the zone who needs a ride, and plays the whole run back on the map in about two minutes, with the fire spreading on the drill's clock. Each home turns green (out before the fire), red cross (truck got there after the fire) or red flame (never reached). It never touches `vehicles`, `plans` or `assignments`.
- **Numbers, not a scripted failure:** 20 mph average and 2 spare seats (`ENGINE` in `convex/vehicleRun.ts`, editable in the panel). The competent heuristic (`convex/heuristic.ts`) orders the pickups; the run is driven on the road graph with the real boarding times and shelter round trips. In the 200 simulated homes: 82 homes need a ride, one engine gets 15 people out, reaches 13 after the fire and never gets to 154. The same plan needs 12 engines to reach everyone.
- **Who it picks up:** in-zone households whose outcome is `needs_ride` or `needs_accessible`. Before the calls have found anyone, it uses the truth cards of the 200 homes the warning seeds, and the panel says so.
- **Contract:** new table `truckDrills` (one row, the latest drill), functions `truckDrill:run`, `truckDrill:latest`, `truckDrill:clear`. Reset and rewind clear it (`NIGHT_TABLES`). `seed.ts` now builds the area with `sampleHomes`, with the same random draws in the same order, so the seeded town is unchanged. `demoAreaHomes()` returns it without writing anything.
- Tests: `npm run test:truck`.

## 2026-10-25 00:56

**The wildfire spreads like a real one now, and every home's deadline moved.**
- **Scenario fire** (`data/hazard/scenario.geojson`, `public/scenarios/altadena.json`, `convex/scenarioFronts.ts`; `00105c0`): `modeling/scripts/spread_model.py` now writes it, seed 7. The wind is a seeded walk around a Santa Ana mean (pushing toward 242°, 45 km/h) with gusts and 25-45° shifts. Washes and water never burn. Roads hold it by width, and parks, schools, parking, golf, pitches and cemeteries slow it. Brush speeds it, and some homes never catch. Embers fly downwind of the wind of the moment, which is the only way it crosses the Arroyo Seco. Fronts can be MultiPolygons with holes (101 islands in the last front). Barriers come from `public/map/altadena.json`, so they match what the map draws. Rerun: `cd modeling && uv run python scripts/spread_model.py && cd .. && npx tsx scripts/hazard/bake-scenarios.ts`. Keep seed 7: the demo is rehearsed on it.
- **Deadlines moved.** Over the 200 seeded demo homes, the median shift is 8 minutes earlier, with a range of 137 minutes earlier to 200 minutes later. The median arrival went from 168 to 150 minutes, and the first home still burns at minute 84. The live deployment still holds the old arrivals for tonight's homes. They're recomputed at the next warning (`retimeArea`), so rewind and re-issue the warning before rehearsing.
- **Fire field** (`e7828b1`): `ScenarioFront` gained optional `polygons` (every piece, with holes). `ring` is still the largest piece's outline, so the smoke layer and `downwindOf` read it as before. `arrivalAt` and `buildFireField` honor holes, and `holds(front, x, y)` is new. Paradise's fronts go through the same code.
- **Rehearsal fire** (`9662ae8`): `ignitionHazard(..., ground?)` takes the map's roads and areas, and `useSimulatedFire` passes them. The wind walks on a seed (the lit building), and some buildings never catch. Burning buildings throw spot fires. The burn is drawn per footprint, so a standing home shows inside it. Boris: the burn now comes as many small polygons instead of one hull. Your flames read it through the field, unchanged.

## 2026-10-25 00:59

**Fire crews now work the night on the rescue map** (`af1fd2c`, `a49f49b`). Nothing new in Convex: no tables, no functions.
- **What you see:** four engines (LA County Stations 12 and 11 in Altadena, 82 and 19 in La Cañada Flintridge; points approximate) leave at the warning and go door to door. A dotted ink line shows the street to the next door. At a door the engine parks at the curb, and an ember arc closes as the visit runs. A small check stays on every door they knocked. The "Fire crews" panel at the top of the right column lists what each engine is doing.
- **How they choose:** soonest fire first, then the most help needed (`needProbability`, plus the Ready check's walker, wheelchair or lift), weighed against the drive. They drive the drawn streets at the truck drill's 20 mph (`ENGINE`), stay 4 to 22 minutes by mobility (the same boarding minutes the dispatcher uses), and always leave 3 minutes before the fire. They ignore closures, because closures stop the public, not the fire department.
- **It's a playback.** It's planned in the browser (`lib/ink-map/fire-crews.ts`, `components/rescue/use-fire-crews.ts`) from each home's place, fire arrival and mobility only, so the same night always plays the same way. It never writes to a household, so the "Doors to knock" queue and call outcomes are untouched. It follows whichever fire the map draws: the scenario, a lit rehearsal fire, or the drill's clock while a drill is stored.
- **Contract:** `convex/model.ts` now exports `boardingMinutesFor`. Nothing else changed.
- Tests: `npm run test:map` (`lib/ink-map/fire-crews.test.ts`).

## 2026-10-25 01:13

**Voice: new fixed line `waitingForRequest`** ("I'm putting in your ride request now. No driver has accepted yet. I'll call you back the moment one does." plus the safety line), in all 10 languages. `rideLine` uses it when the ride need is known but no request has reached the call yet; before, it said the `received` template ("I've placed your ride request"), and the exam judge called that an invented fact. Graders that strip every fixed line from `voice/agent/lines` pick it up on their own. The honesty guard also drops "we've got you", "your dog is coming with you" and "ya lo tenemos" from Claude's words while no driver has accepted (approved answers can still say a pet may come).

## 2026-10-25 08:30

**Voice deploys now drain live calls, and the next one waits about five minutes.** Since d4b9ba2 the server stops dialing on SIGINT and lets live calls finish (up to 280 s, `kill_timeout = 300` in `voice/fly.toml`). The image ran under `npx tsx`, which didn't pass the signal on, so v54 waited the full five minutes and then was killed anyway. 36e502e starts it with `node --import tsx`. The first deploy of main after this still stops the old server and waits; after that a deploy with no live call restarts at once. A call dropped by a restart stays "live" in Convex for 30 minutes and holds the deploy guard until then (`/live` on the server is the real count).

## 2026-10-25 01:46

**A judge's phone now follows their house all night, and says whether the resident got out.** After "Take this house", `/join` moves the phone to `/you/<token>` (public, no role). It shows the live stage (warning, call, ride requested, driver accepted with first name and minutes away), minutes until the fire reaches the home, and in the end a verdict: safe (boarded a van, left with a neighbor, drove out, or nobody home) or "did not make it" (the fire reached the home before anyone got the resident out, or the van boarded after it). The verdict is decided on the phone against the night's clock and `households.fireArrivalAt`; nothing new is written for it. Everything is labelled "Simulation".
- **Contract (additive, optional, deployed):** `claims.statusToken` (24 characters, index `by_statusToken`), `assignments.completedAt` (night clock, set in `completeAssignment`), `claims.session` returns `statusToken`, new query `claimStatus:forToken({ token })`. It returns one house's address, resident name, call status, fire arrival and a driver's or neighbor's first name, never a phone number. `fireArrival.ts` exports `hazardReaches`.
- **Rides and calls from before the claim don't count:** a demo house can carry a finished neighbor pickup from its old resident. The status page ignores rows created before `claimedAt`. Dispatch doesn't: `takeableHome` still lets a judge take a house with an old pickup plan, so `helperCovers` may hold back a van for it. Worth a look by whoever owns pickups.
- **`claim` now clears `away`**, which an old "nobody's home" call left on the house.
- **New `claims:releaseHouse({ householdId })` (internal):** gives back one judge's house. Use it to undo a test claim; `clearAll` also clears every real judge's house (one is on the deployment now, +86...).
- Tests: `tests/workflow/claimStatus.test.ts`.

## 2026-10-25 03:45

**Devpost check:** the README now says the live solver is ALNS, not OR-Tools (`convex/dispatchWorld.ts` asks for `alns`), so the DigitalOcean paste above says so too. Whoever has the Devpost text: check it against the README's sponsor table. Gemini, Elastic, Fetch.ai and Bright Data are built but haven't run, and Atlassian isn't deployed. Don't call any of them live.

## 2026-10-25 09:10

**Neighbor pickup asks: one truthful appeal, then no repeat asks.** Additive contract changes only. `households.helperDeclinedAt` (optional, night clock) is set when a recruited neighbor turns down a pickup, and `canDrive` (convex/neighborRules.ts) now returns false for them, so 911 asks them for nobody else tonight. `pickups.callQueue` rows gain `appeal: { driveMinutes, fireMinutes, driverComing } | null` for recruited plans. On the call, a neighbor who wavers or gives a soft no hears once: the resident's need, their real drive time, "no driver has said yes yet" (only when true), and that going to the resident takes them away from the fire (true by `awayFromTheFire`). A firm no or a second no is thanked and let go.
