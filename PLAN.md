# Standard Response

We connect an evacuation warning to a confirmed, needs-matched ride for people who can't leave on their own. Wildfire is the default hazard, and the Eaton Fire is the scenario the app runs on.

## Summary

**The question we answer.** An evacuation warning has gone out. Who still can't leave, and who has actually agreed to pick them up?

**Rider Check.** A paratransit agency loads its rider list and draws the warning zone. Our voice agent calls every rider inside it. Answers become dispatch requests, and an optimizer matches each one to a vehicle that can actually do the pickup (space and crew). A dispatcher approves, a driver accepts on their own phone, and only then does the rider get a call back.

**The change moment.** One rider's situation changes. The caller corrects an answer mid-call, and the pickup goes to a crew that can lift. The driver accepts. Then a road closes and the van can no longer reach the rider. The rider is told the truth right away, a stale offer from the old plan is rejected, and a new driver accepts.

**Before the night: Ready check.** Registries failed because nobody had the people to call through them when it counted. AI agents do. Ahead of any disaster, the agent calls every household (or the household signs up on its phone) and records who lives there, what help they need getting out, where they sleep, and who has agreed to pick them up. When a warning goes out, the agent calls every one of those helpers first. A pickup that isn't happening becomes a ride request at once, already filled in from the profile, and the rescue map shows it.

**Honesty rule.** Every update reflects the latest confirmed assignment, and the resident hears right away if it changes. Code ties what the agent may say to request status; the prompt doesn't.

**Stability rule.** Re-planning never adds stops to a run a driver has accepted, and never hands an accepted pickup to someone else. A pickup leaves a driver's run only when no route reaches it in time or the driver cancels it.

**Proof standard.** We report dispatch gains against a competent heuristic on identical requests, separately from outreach gains. We report call accuracy per field and failure cases (cancellations, stale acceptances), not only reassurance pressure.

**Core line.** "The vans were ready at 4am. The call came at 6:03. Nothing connected them."

## How we work together

Nobody owns a piece of the app. Whoever finds something that needs fixing fixes it, wherever it is. The app has four parts, and each builds against the shared Convex contract. Each part's stand-in is a switch under Simulation settings on the call floor.

| Part | Covers |
| --- | --- |
| Interface | Every screen: call floor, rescue map, driver page, under-the-hood screen, simulated phone panel |
| Voice and calls | Telephony, the voice agent, dialer, reach ladder, text handling, callbacks |
| Dispatch and simulator | Road graph, closures, the solvers, the heuristic, vehicle movement, the simulator |
| Modeling and evaluation | Hazard scenario, door-check queue, address matching, synthetic population, persona cards, the persona eval and grader |

### Rules for every agent and teammate

These are also in `AGENTS.md`, which every coding agent reads.

1. **Commit only to `main`.** Pull with rebase before starting a task and before every commit. Push right after each commit. Never force-push or rewrite history.
2. **Watch `main` for pushes.** Fetch `origin` at least every 5 minutes while working. When new commits land, pull them, read any changed notes addressed to you, and re-run `npm run typecheck`.
3. **Talk through notes files.** `notes/boris-to-brendan.md` holds notes from Boris to Brendan, and so on for every pair; `notes/boris-to-everyone.md` is for the whole team. Only the sender writes their file. Add each note at the bottom under a timestamp heading. Reply in your own file to that person.
4. **Tell readers before changing the contract** (see [Contract](#contract)). Write a note to everyone who reads the table before pushing the change, and keep old fields working until nothing reads them.
5. **Secrets never go in git.** The shared env file (`CONVEX_URL`, `ANTHROPIC_API_KEY` and the rest) is pinned in the team chat. Save it locally as `.env.local`, which git ignores.
6. **Stand-ins stay working.** Never break a stand-in someone is building against. Switch it off under Simulation settings instead of deleting it.

## The problem

In every major disaster for 20 years, the people who die are disproportionately the ones who can't leave on their own, and nothing reliably connects them to the vehicles that could get them out.

**Case study (Eaton Fire, January 2025).** A disabled father who used a wheelchair and his son with cerebral palsy lived in west Altadena. Relatives trying to reach them were turned away at the perimeter. The evacuation order for west Altadena came at 3:25am, and no warning preceded it. Access Services, the county's paratransit provider, said it was ready by 4am and was never called. The father called 911 at 6:03am and again at 6:14, and a relative called at 6:35. The dispatcher said "we have a lot of calls in that area." Both men were found dead around 8:30am. The son needed two or three people to get him out of bed.

| Disaster | Deaths | Who died |
| --- | --- | --- |
| LA County fires (2025) | 30 | Mostly older, many disabled. Average age of the 17 Eaton victims counted then: 77 |
| Lahaina, Maui (2023) | 102 | More than two-thirds in their 60s or older |
| Camp Fire, Paradise (2018) | 85 | A majority over 65 |
| Hurricane Katrina, Louisiana (2005) | 971 | Almost half 75 or older |

- **Can't leave alone.** Only 20% of people with disabilities can evacuate immediately without difficulty, and 6% can't at all (UN survey, about 6,000 people).
- **Why the system fails.** Investigators found evacuations were never formally part of incident command, field reports didn't reach commanders, and the sheriff was short on vehicles. Dispatchers fall back on reading addresses over the radio, and nothing matches vehicles to people by need.
- **Why registries fail.** During Hurricane Harvey, fewer than 5% of Texas registrants were contacted. LA County shut down its earlier registry for "low return on investment." Advocates warn registries create false assurance.
- **What exists today.** One-way alerts (phone alerts, reverse 911, Watch Duty), zone software (Genasys), keypad polling (Everbridge) and inbound AI hotlines. None of them does outbound conversational triage plus confirmed, needs-matched transport.

## Positioning

We are assisted evacuation coordination for people with access and functional needs (AFN). Emergency managers use "AFN," and using it tells a public-safety judge we did our homework. The operator picks the hazard before the warning (wildfire, earthquake, flood or hurricane, in `convex/hazards.ts`), and the voice agent's safety line and emergency rule follow it.

## What the system does

One rider's path, from the moment a warning covers their street to the moment they hear who's coming, and what happens when that changes.

1. **Load and target.** The agency uploads its rider list (CSV) with mobility needs already on file. A dispatcher draws the warning zone. Riders inside it enter the call queue, ordered by deadline and known need.
2. **Have a real conversation.** The agent confirms rather than interrogates: are you still at this address, can you leave now, who's with you, has anything changed about mobility or medical needs, and how much help do you need getting out ("two people to lift"). It fills a structured record during the call and reads it back. Before hanging up, it asks: "Is there anyone else on your street who might not be able to leave?"
3. **Handle corrections.** "My husband uses a wheelchair, but he isn't here" has to remove a wheelchair need already recorded, and the change has to reach any open offer. Corrections are tested, measured and shown live.
4. **Never treat silence as safe.** No answer means a retry at 2 and 5 minutes, then a text, then the door-check queue for field teams.
5. **Plan pickups that can actually happen.** The optimizer matches each request to a vehicle with the right space (seat, wheelchair, stretcher) and the right crew (lift-capable, enough people) before the scenario deadline.
6. **Approve, then confirm.** The dispatcher approves new offers on the rescue map. Each affected driver gets the offer on their phone. Approval is internal, so the resident hears nothing new until a driver accepts.
7. **Close the loop.** On acceptance, the rider gets a templated callback: "A wheelchair-accessible van with a two-person crew is 6 minutes away. The driver's name is Maria. I'll call again if anything changes."
8. **Tell the truth when it changes.** When a road closes, the driver is first re-routed to the same pickup. If no route reaches the rider before the deadline, or the driver cancels, the pickup is revoked, the rider is told within seconds, and a new driver is found.

### Request status and what the agent may say

The 911 dispatcher's "help is on the way" is part of this story. Our agent can't say it unless it's true, and must say so when it stops being true. Code enforces this table.

| Request status | Agent may say | Agent may never say |
| --- | --- | --- |
| `received` | "You're on the rescue list as high priority. No driver has accepted yet. I'll call you back the moment one does. If you can leave safely, leave now. If fire reaches your home, call 911." | Any promise of pickup or ETA; free-text reassurance ("don't worry," "they'll be there soon") |
| `approved` (internal) | Same as `received`. Approval isn't a promise. | "Someone has been assigned" |
| `driver_accepted` | Driver name, vehicle type, crew and the optimizer's ETA, inserted by template; "I'll call again if anything changes." | An ETA Claude generated itself |
| `en_route` | Updated ETA from the vehicle's position | "Stay put no matter what" |
| `reassigning` | "Your driver can no longer reach you. You're still at the top of the list. I'll call the moment a new driver accepts. If you can leave safely, leave now. If fire reaches your home, call 911." | The old ETA; silence |
| `arrived` / `closed` | Confirmation, shelter name | Anything about other residents |

The transitions live in `convex/requests.ts` and are the only way status changes:

```
received ──approve──► approved ──(offer open)──► driver accepts ──► driver_accepted ──► en_route ──► arrived ──► closed
   ▲                     │                                               │
   └── decline, expire ──┘                         no route in time, or driver cancels
       or replaced (silent)                                              ▼
                                                     reassigning ──new accept──► driver_accepted
```

- The order is always: dispatcher approves, the driver is offered the assignment, the driver accepts, then the callback fires. Approval never triggers a callback.
- A rider is only ever called about a driver who accepted. An open offer that is declined, expires or is replaced by a new plan sends the request back to `received` with no call, because the rider never heard about that driver.
- **Hard escalations.** An address the agent can't confirm after two tries, a medical emergency, or "I can see flames" sends the record red to the top of the dispatcher's list, and the agent tells the caller to call 911 if they can. Nobody is just handed back to the line that failed the father and son.
- **Red-team set.** 25 callers who push for reassurance, each with the ride pinned at `received` and at `reassigning`, plus 10 change cases: a driver cancels, a road closes after acceptance, a stale acceptance of a replaced offer, duplicate accepts and cancels, a silent decline, a silent expiry, corrections that drop an open offer or revoke an accepted one, and a status change while the agent is mid-sentence (`data/redteam-change-cases.json`).
- **Two honesty numbers.** Template-level false promises are zero by construction, so we also measure what can fail. A separate grader model scores how often Claude's free text implies help is coming while status is `received` or `reassigning`, with a human spot-check sheet (`data/honesty-spot-check.csv`). The under-the-hood screen also shows the time from each callback being queued to its template playing.

## Ready check and pickup check

A registry with nobody to call it is worse than none: it promises a check that never comes. Harvey and LA County's old registry failed for lack of hands, and AI agents remove that limit. So the list is built ahead of time and worked through the moment a warning covers a street.

### Before the night: Ready check

1. **Every household gets a profile.** The voice agent calls each home in the agency's area, or the household fills in `/ready` on its own phone. Both write the same profile:
   - who lives there: head count, the most limited mobility, help getting out (`none`, one person, two-person lift), oxygen or dialysis, pets, car
   - care needs firefighters plan around: hard of hearing, low vision, memory loss, a power-dependent device, a service animal
   - where the person who needs help sleeps (ground floor, upstairs or basement; front or back), plus a short note for the crew ("key with the neighbor at 1214")
   - the plan for getting out: own car, a named helper (name and phone), or a ride from us
2. **Profiles reach the night.** The call queue calls known needs first, and the evening call confirms what's on file instead of asking cold. A profile never creates a ride request by itself; only a warning does.
3. **Sign-ups are unverified until called.** A `/ready` sign-up is marked `via: "form"` and the agent confirms it by phone before it counts as verified. The list is sensitive: real data only under the agency's authority.

### During the night: pickup check

When a warning covers a household with a helper on file:

```
arranged ──warning──► checking ──helper says yes──► coming ──resident says picked up──► done
                         │                              │
            helper says no, or no answer twice    resident says no one came
                         ▼                              ▼
                    fell_through ──► ride request from the profile (or door check if the resident can't be reached)
```

- **The helper is called first,** then the resident once the helper's ETA has passed. Nobody waits on a broken promise: 8 minutes without a yes counts as fell through.
- **No double booking.** While a pickup is `checking` or `coming`, `syncRequest` opens no ride request for that home. Once it falls through, the request opens immediately, needs already filled in from the profile.
- **What the resident hears doesn't change.** A fallen-through pickup is a normal ride request, so the honesty table above still governs every word.
- **On the rescue map,** a helper's pickup is drawn along the streets they drive from their home to the resident's: dotted while it's only on file, marching while we call, and solid once they're coming. If the pickup falls through, the line breaks in red and the home becomes a red ride request. Clicking any home opens its profile card, which a firefighter reads before going in.

## Contract

One real-time database (Convex) that every part of the app reads and writes. Nobody calls anybody else directly. The schema is `convex/schema.ts`.

> **The hard problem, in one sentence for judges.** "This is dynamic vehicle routing where the deadlines move with the fire, you don't know who needs a ride until you reach them, and every promise has to stay true while the plan changes underneath it." Say it early in every pitch.

**Depth rule.** Every component has one number that survives "how did you set that?" If the honest answer is "we hardcoded it," simplify and say so.

### Tables

| Table | Written by | Read by |
| --- | --- | --- |
| `households` record fields (`canLeave`, `mobility`, `assistanceRequired`, ...) and `corrections` | The voice agent (`households:update`) | everything |
| `households.needProbability`, `fireArrivalAt`, `doorPriority`, location | The models (`households:setEstimates`, `doorChecks:setPriorities`, `households:setLocation`) | everything |
| `households.inZone`, rider import | The interface (`riders:importCsv`, `riders:setZone`) | voice, dispatch |
| `calls`, `transcriptLines`, `texts` | The voice agent; the phone panel writes resident replies (`texts:reply`) | interface, evals |
| `requests` and every status change | `convex/requests.ts` only | everything |
| `vehicles`, `shelters`, `plans`, `assignments`, `auditLog` | The dispatcher (`plans:propose`, `vehicles:setPositions`); the interface calls `offers:approve`, `offers:accept`, `offers:decline`, `offers:cancelByDriver` | everything |
| `callbacks` | `offers.ts` queues; the voice server calls `callbacks:markPlaced`, `markPlayed`, `markUnanswered` | interface, voice |
| `roadClosures` | The hazard runner, the manual control, resident mentions on calls and driver reports, through `roads:addClosures` | everything |
| `nominations` | The voice agent (`nominations:add`), address matching (`nominations:resolve`) | interface |
| `personas` | Seed and the evals only | Stand-ins, the evals, and the judge kiosk's starting record for a demo house (`claims:draft`). The voice agent and the models never read it |
| `households.ready` (the Ready check profile: `at`, `via`, `verified`, `exitPlan`, `bedroom`, `care`, `note`) | The interface (`ready:submit`), the Ready check stand-in, the voice agent (`ready:saveFromCall`) | everything |
| `pickupPlans` (prearranged helpers and the pickup check) | `ready:submit`, the stand-in; the voice server through `pickups:startAttempt`, `pickups:helperAnswered`, `pickups:residentAnswered`, `pickups:unanswered` | interface, voice, dispatch |
| `control` | The call floor's stand-in switches | stand-ins |

### Rules the contract already enforces

These live in `convex/offers.ts`, `convex/plans.ts` and `convex/requests.ts`, so every dispatcher, stand-in or real, keeps them.

- **Compatibility.** `plans:propose` refuses an offer to a vehicle without the space, crew or lift the request needs (`vehicleCanServe` in `convex/model.ts`).
- **Accepted runs are frozen.** `plans:propose` refuses a new offer whose `stopOrder` isn't after every accepted stop on that vehicle, and refuses a second live offer for the same request.
- **Version-checked accept.** `offers:accept` returns `"changed"` unless the offer is still open. Convex runs the check and the write in one transaction.
- **Offers expire** after 2 minutes through a scheduled function.
- **Callbacks are idempotent.** Each is keyed by request, assignment and announced status; a duplicate is logged and ignored.
- **Corrections reach offers.** `households:update` logs a correction when a field changes, then `syncRequest` updates the request and drops any assignment the vehicle can no longer serve. An open offer ends silently; an accepted one is revoked and the rider is called.

### Files shared outside Convex

| File | Written by | Read by | Shape |
| --- | --- | --- | --- |
| `data/sample-riders.csv` | The models | The CSV upload | `rider_id,name,address,lat,lng,phone,language,mobility,assistance` |
| `data/population.json` | The models | The simulator | Array of `{ id, lat, lng, age, peopleCount, mobility, assistanceRequired, medical, hasCar, canLeave, answersPhone, language }` |
| `data/hazard/scenario.geojson` | The models | The simulator, the maps | Polygons with a `minutesAfterWarning` property |
| `data/personas.json` | The models | The persona eval, the voice tests | Array of persona cards with `truth` (as in the `personas` table) and an optional `correction` |
| Text agent endpoint | The voice server | The persona eval | `POST /turn` with `{ sessionId, language, text }` returns `{ reply, stage, record, done }` |

The simulated area seeded on the call floor uses the stand-in fire in `convex/model.ts`. The persona eval runs against the voice server's endpoint, or in process against the scripted agent in `modeling/rollcall_d/scripted_agent.py` behind the same shape.

### Stand-ins (Simulation settings)

Press **Issue evacuation warning** on the call floor. On an empty deployment that seeds 200 simulated households, 8 vehicles (Maria's and Luis's vans are left for the driver page) and one shelter, then starts the loop. Each switch under Simulation settings on the call floor runs or stops one stand-in.

| Switch | Fakes |
| --- | --- |
| Voice agent, dialer and callbacks | Rings, scripted calls in English and Spanish, retries, texts and replies, callbacks heard |
| Dispatcher and vehicle movement | Nearest compatible free vehicle for each waiting request, vehicles driving straight lines to pickups (it ignores closures) |
| Drivers not on the driver page | Simulated drivers accept their offers after 6 seconds |
| Dispatcher approval | Approves every proposed offer at once |
| Need model | Census prior shrunk toward nearby answered calls |
| Ready check and pickup check (under the voice switch) | Ready check calls before the warning, filled from persona cards; helpers answering, confirming and sometimes not showing up. With the switch off, the voice server places these calls |

## Interface

Every screen works against the stand-ins.

**Rescue map** at `app/map/page.tsx`, reusing `components/ui` and the tokens in `app/globals.css`.

- Requests (`requests:open`), vehicles (`vehicles:list`), accepted runs and open offers (`offers:active`), closures (`roads:closures`), the zone (`riders:currentZone`), door-check order (`doorChecks:queue`) and nominations (`nominations:open`).
- Red escalations at the top of the list.
- One-click approval of proposed offers (`offers:approve`). Turn off "Dispatcher approval" to use it.
- CSV upload (`riders:importCsv`) and zone drawing (`riders:setZone`).
- The plan version and solver from `plans:latest`.

**Driver page** at `/driver`. A phone-sized page with a driver picker, so one phone can act as any driver. It shows the driver's accepted run in stop order and open offers (`offers:forVehicle`), with Accept, Decline and "I can't make this pickup" (`offers:cancelByDriver`). A `"changed"` result from `offers:accept` shows "Assignment changed."

**Under-the-hood screen** at `/system`. Architecture, latency p50 and p95, per-field accuracy, corrections, honesty numbers, the change cases, simulator results with ranges, sensitivity, door-check fairness, the need model, callbacks and the audit trail (`plans:auditTrail`). It holds the "Close this road" control, which writes a `manual` closure through `roads:addClosures` so the demo's closure lands on cue. Every re-plan shows requests, vehicles, solve time, plan version and changed offers. Every simulator number shows a range.

**Simulated phone panel** at `/phone`. The text channel (`texts:threads`), with a reply box that writes `texts:reply`. It's labeled as simulated.

**Call floor** at `/dashboard`, with the stand-in switches under Simulation settings. The root page `/` is the judges' kiosk.

## Voice and calls

Hands off to: `households`, `calls`, `transcriptLines`, `texts`, `nominations`; places the calls in `callbacks`.

**Telephony.** Twilio Programmable Voice by default, or Cartesia's telephony with `VOICE_CARRIER=cartesia`. On Twilio, each call streams 8 kHz μ-law audio over Media Streams to the call server (`voice/server.ts`), one async session per call.

**Speech loop.** Cartesia Ink for speech-to-text, then Claude, then Cartesia Sonic for the voice, so Cartesia carries both directions. Voice activity detection handles turn-taking and interruptions.

**Who decides what.** Claude interprets messy speech and phrases replies. A deterministic state machine decides what to ask next and what may be promised. Don't weaken that split to make Claude look more autonomous, because it's our answer to Anthropic's "where could it go wrong."

**Corrections.** Every field in the record carries a confidence. Corrected fields go through `households:update`; the contract logs the correction and drops offers the vehicle can no longer serve. The read-back before hanging up ("two people, one wheelchair, needs two people to lift, 100 Terrace St, is that right?") is where most corrections land.

**Languages.** Calls run in the ten languages in `SPOKEN_LANGUAGES` (`convex/languages.ts`). The English and Spanish lines are reviewed by fluent speakers; the others are machine translations.

**Model and latency.** Claude Haiku 5.5 (`claude-haiku-5-5`) runs the turns by default, and `VOICE_MODEL=claude-opus-5-5` runs Opus 5.5 in fast mode. The budget is under 1 second per turn. Replies go out sentence by sentence, record writes are fire-and-forget, and a short backchannel covers the wait when Claude is slow. Per-turn latency is logged so the under-the-hood screen can show p50 and p95.

**Outbound dialer.** Calls `households:queue` (in-zone households only, highest priority first), drained by a token bucket sized to Twilio's default of 1 call per second. A 200-rider zone takes about 3.5 minutes to dial. Answering-machine detection leaves a short voicemail and schedules a retry.

**Reach ladder.** Call, retry at 2 minutes, retry at 5, text, door-check queue (`calls:end` and `calls:resolveFollowUp`), run as one durable workflow per rider in `convex/reachLadder.ts`. Status callbacks use the same ladder; an unanswered `reassigning` call is retried and then texted.

**Text fallback.** After the voice attempts fail, a text with numbered replies goes out (`texts:send`), and Claude reads replies from `texts`. Texts live in Convex and show on the simulated phone panel.

**Live status during calls.** The call subscribes to `requests:forHousehold` for its whole length. When status changes, the agent interrupts at the next sentence boundary and plays the new template. Every agent line in `transcriptLines` carries `requestStatus` so the grader can check it.

**Callbacks.** The voice server subscribes to `callbacks:pending`, places each call, then marks it placed, played or unanswered.

**Neighbor question.** Spoken addresses go to `nominations:add`.

**Inbound callers.** `households:findOrCreateByPhone` returns a household; unknown numbers get one with no location, flagged for an address check.

**Hard escalations.** `requests:escalate` with `medical`, `flames` (or `hazard_at_home` for other hazards), `address_unconfirmed` or `language_barrier`.

**Text agent endpoint** for the persona eval: `POST /turn` with `{ sessionId, language, text }` returns `{ reply, stage, record, done }`, running the same state machine and prompt as phone calls.

**Test without the other parts.** Turn off the voice stand-in. The seeded households give you a queue, and the dispatch stand-in produces `callbacks`. To drive a status change mid-call, call `offers:accept` or `offers:cancelByDriver` from `npx convex run`.

## Dispatch and simulator

Hands off to: rescue map (plans, offers, vehicles), the voice agent (status changes, callbacks).

**Road network.** OpenStreetMap through OSMnx (`dispatch/build_graph.py` writes `data/roads/altadena.json`): edges with length, speed limit and lanes, and free-flow travel times. Closures from `roadClosures` snap to edges (`roads:setEdgeKey`). Closures come from the hazard runner, drivers' reports ("Lincoln Ave blocked"), residents' mentions on calls (unconfirmed until checked) and the manual control. Dijkstra on the west Altadena graph takes about a millisecond, so every vehicle, request and shelter path is recomputed on each change.

**Dispatch optimizer.** A dynamic dial-a-ride problem: a mixed fleet, pickups and drop-offs, deadlines, re-solved whenever the world changes. The Convex dispatcher (`convex/dispatch.ts`) reads requests, vehicles, offers and closures, and writes through `plans:propose`.

- *Requests:* pickup node, eligible shelters (any one), load vector, crew needed, lift needed, boarding time (about 2 minutes walking, 5 with a walker, 10 in a wheelchair, 20 bedbound or two-person lift), deadline and weight. All but the nodes are already on `requests`.
- *Vehicles:* position, passengers on board, capacity vector, crew size, lift capability, shift end, and the accepted run it's on.
- *Objective:* expected deaths under the assumed fatality-risk model in `dispatch/fatality.py`, priced so one expected death outweighs any amount of driving; then each rider's waiting, weighted by need; then vehicle time; plus a cost ν for each open offer moved to another vehicle. A rider's risk is zero when they board by their deadline and rises linearly to its maximum at fire arrival. A request that can't be served at all is dropped at its worst-case cost. The risk model is an assumption, not a prediction about real people.
- *Constraints:* pickup before drop-off on the same vehicle, capacity per dimension, crew and lift compatibility, maximum ride time for oxygen users, shelter capacity, and accepted runs frozen.
- *Solvers:* three dispatchers take the same problem and return the same routes shape. The first is the competent heuristic (`dispatch/heuristic.py`). The second is OR-Tools Routing (`dispatch/solver.py`), with pickup-and-delivery pairs, eligible shelters as a disjunction, three capacity dimensions plus a time dimension, compatibility as allowed-vehicle sets, and each request optional with its drop penalty; it runs parallel cheapest insertion, then guided local search. The third is adaptive large neighborhood search (`dispatch/alns.py`), which starts from the heuristic's plan and never does worse than it on its own objective. The live dispatcher posts each re-solve to the solver service (`dispatch/server.py`) with the ALNS policy and a time limit of up to 3 seconds.
- *Re-planning:* every 5 seconds while riders or offers are waiting, every 30 seconds otherwise, and right away when a road closes. Open offers the new plan keeps aren't touched, so a driver always gets the full 2 minutes to respond. Changed ones go in `replace`.
- *Escalation:* requests the solver can't serve in time get `requests:escalate` with `unservable`.

**Accepted runs don't change.** Once a driver accepts, their accepted stops and the order of those stops are fixed. A driver halfway through picking up three evacuees finishes that run before anything new reaches them.

- The solver never moves an accepted pickup to another vehicle or inserts a pickup into an accepted run. A vehicle gets new offers only for stops after its last accepted drop-off. The contract refuses anything else.
- When a road closes, the solver re-routes the same vehicle to the same stops.
- An accepted pickup goes in `revoke` only when no route reaches it before its deadline. The rest of that driver's run stays as accepted.
- The ν penalty applies only to open offers, so re-solves don't churn offers a driver is still looking at.

**Vehicle movement and ETAs.** Vehicles move along road paths (`vehicles:setPositions`), requests move to `en_route` and `arrived`, and `etaMinutes` stays current. The dispatch stand-in in `convex/dispatchStandIn.ts` moves vehicles in straight lines.

**Competent heuristic.** Earliest deadline first, type and crew matched, greedy insertion after each vehicle's accepted run. It's the baseline we must beat and the fallback dispatcher (`convex/heuristic.ts`) when the solver service is slow or down.

**Simulator.** A discrete-event simulation (SimPy, `dispatch/sim`) of a night: the hazard advances, calls are answered or missed, vehicles drive, roads close and drivers sometimes cancel. Every assumption is labeled.

- Policies on identical scenarios: today's process (911 first come, first served; context only), the competent heuristic, OR-Tools and ALNS.
- Separate results. *Dispatch only:* both dispatchers get identical requests at identical times, which is the honest optimizer number. *Outreach only:* the heuristic dispatcher with requests arriving when our calls would surface them. *Combined.*
- Metrics: pickups on time (boarded by the deadline) as the primary metric, plus late pickups, riders never picked up, worst wait, wait for wheelchair and bedbound riders, vehicle-minutes, and expected deaths under the assumed risk model. 100 seeds, reported with ranges.
- Sensitivity panel: fleet size, answer rate, hazard speed and how early 911 callers phone, plus one honest line about where we don't help (`whereWeDontHelp`).
- Ground truth comes from `data/population.json`. The simulator evaluates a policy; it doesn't validate predictions about real households, and the screen says so. Results go to `data/sim-results.json` for the under-the-hood screen.

**Exploration** (`dispatch/sim/exploration.py`), labeled as assumption-driven: "What happens if everyone leaves at once?"

- Edge travel time from the BPR curve, t = t₀ (1 + 0.15 (v/c)⁴), with residents who drive loaded onto the network by departure time.
- Departures from a drift-diffusion model, dX = μ(t) dt + σ dW, leaving when X crosses a threshold. Two classes (evacuation-keen and evacuation-reluctant, per Berkeley's survey of California evacuees).
- The effect of a phone call on departure is an assumption explored in simulation, not a finding.

**Test without the other parts.** The voice stand-in fills households and requests; the stand-in fire gives deadlines; add closures yourself with `roads:addClosures`.

## Modeling and evaluation

Hands off to: the simulator (population, hazard file), field teams (door order), the interface (sample CSV), the voice agent (personas, nomination matches). The code is in `modeling/`, and it calls Convex from Python.

**Sample rider list.** `data/sample-riders.csv` holds 40 fictional riders at real west Altadena address points, including Carmen and Walter for the demo.

**Hazard scenario.** The Eaton Fire as it burned, building by building, from CAL FIRE's final perimeter and the dated fire reports in the UL FSRI timeline (`modeling/scripts/build_eaton_fire.py`), saved as `data/hazard/scenario.geojson`. A runner script advances it during a session: it writes each household's `fireArrivalAt` through `households:setEstimates` and adds a `hazard` closure through `roads:addClosures` when the fire reaches a road within a safety margin. On screen: "Scenario input, not a forecast." The hazard never marks anyone safe: an unanswered household is always unknown. Say this unprompted.

**Door-check queue.** Calls scale, but door-knock teams don't: with 6 teams and 400 unreached homes, order matters. The queue is a transparent score (`modeling/rollcall_d/door.py`), written through `doorChecks:setPriorities`.

```
priority_h = (p_h · u_h) / τ_h + α · wait_h
```

- `p_h` is the need estimate. Known need from the rider list or a call comes first, and a neighbor nomination raises it sharply. Otherwise it's the census base rate: age 65+, no vehicle and 65+ living alone by block group, and disability by tract, since ACS publishes disability status (table B18101) only down to the tract. Spatial smoothing from answered neighbors is one term the rescue map can switch on and off.
- `u_h` is urgency from the hazard deadline, and `τ_h` is travel time for the nearest team on the road graph, closures removed.
- `wait_h` is minutes on the list. This aging term guarantees no household, however isolated, stays last forever. α is set once per incident so that 30 minutes on the list is worth as much as the 90th-percentile need-and-urgency term when door checks start.
- Guardrails: the score only orders visits and nobody is skipped because of it. Estimates are shown as estimates, and no individual risk scores appear on screen.

**Address matching.** Nominations from `nominations:open` and unlocated inbound callers are matched against existing households, then OSM address points in the zone. Matches go through `households:setLocation` and `nominations:resolve`; unmatched nominations stay flagged for the dispatcher with the reason.

**Synthetic population.** The standard method, as in PopGen and ActivitySim: draw real ACS PUMS household records from the PUMA(s) covering Altadena, then reweight them with iterative proportional fitting. Age, vehicles and living alone are fit to block-group totals and disability to tract totals. Because whole real records are resampled, the dangerous combinations (75+, ambulatory difficulty, alone, no car) survive. Saved as `data/population.json`, it feeds simulator ground truth, the persona cards and the door-check base rates.

**Persona cards.** 200 in `data/personas.json`: hard of hearing, partial address, panic, reassurance-seeking, flames, medical, tangents, a second voice, neighbor nominations and mid-call corrections.

**Persona eval.** Runs each card against the text agent endpoint, or against the scripted agent with the same request and response shape. Reports accuracy separately for address, passenger count, mobility and assistance required, plus correction success rate and completion time, to `data/eval-results.json` for the under-the-hood screen.

**Implied-reassurance grader.** A separate grader model reads agent lines with their `requestStatus` and flags implied promises, with a human spot check. Results go to `data/honesty-results.json`.

**Door-check fairness.** `modeling/scripts/door_fairness.py` runs a door-team simulation under four scenarios: baseline, 30% of nominations wrong, one neighborhood answering at half the rate, and an isolated pocket with no answering neighbors. It reports worst-case time to check, not only the average, against random and nearest-first orderings (`data/door-fairness.json`).

**Spread model.** A wind-driven elliptical spread model with fast marching (scikit-fmm) on a uniform fuel grid (`modeling/rollcall_d/spread.py`) generates hazard scenarios, so closures emerge from simulated spread instead of a script. Claim "conservative within our assumptions," never "validated against satellite data": MODIS and VIIRS detections are about 1 km and 375 m, intermittent, and blocked by smoke.

## Evaluation

Call quality is reported per field.

1. **Persona eval (scale).** The 200 text personas.
2. **Voice exam.** `npm run exam:voice` runs every exam item's call against the real agent, graded by deterministic checks and a judge model, scored per module (`data/voice-exam-results.json`).

**Where to push for impressiveness**, in order: the change moment; the compatibility moment (the lift pickup goes to a two-person crew); the correction moment; honesty numbers; the dispatch-only result with ranges and the line about where we don't help; per-field call accuracy; measured latency; door-check fairness.

## Demo

One rider whose situation changes, handled correctly the whole way through, in about 3 minutes in a loud room.

### Table setup

- **Big screen:** the rescue map over the real west Altadena street grid, with the hazard labeled "scenario input."
- **Rider CSV** of fictional riders, ready to import, and a zone to draw.
- **2 or 3 rider phones** with persona cards that include a correction. Example: "Carmen, 79, speaks Spanish. You first say it's just you. Then you remember your son is home: he uses a wheelchair and needs two people to lift him."
- **Driver phone** held by a teammate, on the driver page. Maria's van gets Carmen's offer, and Luis's van has an open offer for a second rider, Walter.
- **Plan panel** on the under-the-hood screen, updating on every re-plan with the plan version, vehicles, requests, solve time and changed offers.
- **Under-the-hood screen** with the "Close this road" control.

### The 3-minute script

1. **0:00 Story.** A father and son. The order came at 3:25am with no warning first. Vans were ready at 4am, and nobody called. Three 911 calls followed, starting at 6:03. "We can't say what would have saved them. We can build the connection that was missing."
2. **0:20 Counterfactual.** "What if the paratransit agency started calling its riders the moment a warning covered their street?" Import the CSV, draw the zone, and the calls start.
3. **0:35 The call.** The judge answers as Carmen, in Spanish or English. Midway they correct themselves: the son is home, uses a wheelchair and needs a two-person lift. The record changes on screen. They ask "Is someone coming?" The agent says: "Not yet. You're on the list as high priority, and I'll call back the moment a driver accepts."
4. **1:05 Technical line and compatibility.** "Under the hood, this is vehicle routing where deadlines move with the fire and the promises have to stay true while the plan changes." Maria's two-person crew gets the offer. The dispatcher approves it. "Approval isn't a promise, so Carmen hears nothing yet."
5. **1:30 Acceptance.** The teammate, as Maria, taps Accept. Carmen's phone rings: "A wheelchair-accessible van with a two-person crew is 6 minutes away. The driver's name is Maria."
6. **1:50 The change.** We close the only road between Maria and Carmen. No route reaches Carmen in time, so the new plan revokes that one pickup. The rest of Maria's run stays as it was. Carmen's phone rings: "Your driver can no longer reach you. You're still at the top of the list." The new plan gives Luis's van to Carmen instead of Walter. The teammate switches to Luis and taps Accept on the old Walter offer, which is rejected on screen ("Assignment changed"). Luis accepts Carmen, and her phone rings with the new driver.
7. **2:20 Proof.** Dispatch-only gain over the competent heuristic on identical requests, with ranges; per-field call accuracy; honesty results including revocation cases. Simulation is labeled as simulation.
8. **2:45 Close.** Last line: "The vans were ready at 4am. The call came at 6:03. We connect them."

### The 2-minute version (demo first, story last)

For Cartesia's format and quick-visit judges.

1. **0:00** The phone rings, and the judge plays Carmen, including the correction and the honest "not yet" (about 35 seconds).
2. **0:35** Two-person crew gets the offer; approval; Maria accepts; callback.
3. **1:05** Road closes; Carmen's pickup revoked while the rest of Maria's run stays; `reassigning` call; stale Walter offer rejected; Luis accepts.
4. **1:35** One line of story; what Cartesia does in the pipeline (Ink hears, Sonic speaks); latency; per-field accuracy; known limitations.

### Q&A prep

| Question | Answer |
| --- | --- |
| "A driver accepts an offer the plan already replaced. What happens?" | Show it: the accept is rejected atomically, no callback fires, and the audit trail shows the old plan version replaced by the new one. |
| "Does re-planning yank drivers around?" | No. An accepted run is fixed, and a driver only gets new offers after their last accepted drop-off. A pickup is revoked only when no route reaches it in time or the driver cancels. |
| "What if the person isn't sure, or changes their answer?" | Corrections overwrite the field, re-run compatibility and are measured (correction success rate in the persona eval). |
| "Would this have saved the father and son?" | "We can't say that. The reporting shows vans ready and nobody called. We built that missing connection; whether it saves a given life depends on things we don't control." |
| "Is your fire model validated?" | "It's a scenario input. Satellite detections can't validate arrival times at individual homes, so we don't claim that." |
| "Don't isolated households always end up last?" | Nobody is skipped: the score only orders visits. On the Eaton Fire our order checks 99% of needy homes in the fire's path before their deadline, against 85% nearest-first. The price is a worst wait about 10 minutes longer than nearest-first, and the aging term doesn't shorten it on this fire, because pulling a team off its block costs driving. Show the fairness panel, worst case included. |
| "Isn't the simulator grading its own homework?" | Ground truth comes from real census records reweighted to real totals. It evaluates a policy, not a prediction, and we say so on screen. |
| "How does this scale to other agencies?" | Each agency runs its own instance on its own riders. |
| "Isn't AI calling people regulated?" | The FCC ruled in 2024 that AI-generated voices count as "artificial voice" under the TCPA. The agency calls its own riders for an emergency purpose, which falls under the TCPA's emergency exception. |
| "Why voice instead of an app?" | Nobody installs anything during an evacuation. Landlines and flip phones work, and riders who can't use screens can still answer. |
| "Who authorizes the calls and assignments?" | The agency. The rescue map is their dispatcher's screen, and no offer reaches a driver without their approval. |
| "Who handles urgent escalations?" | The agency's dispatcher, with red records at the top of the list and the caller told to call 911. |
| "How do assignments reach drivers?" | The driver page on the driver's phone. |
| "What if a rider needs more help than a vehicle can give?" | Compatibility blocks it. If nothing compatible exists in time, the request escalates as `unservable`. |
| "What happens when calls or the solver fail?" | The reach ladder ends in a text and then a door check, the heuristic dispatcher takes over from the solver service, and the audit log shows what was said. |

## Responsible design

- Fictional riders in every demo. Real data only under the agency's authority. Real rider data is deleted when the incident closes, after a retention window (`INCIDENT_RETENTION_HOURS`, 72 by default, in `convex/incident.ts`).
- No individual risk scores on screen. A human approves every plan unless the "Dispatcher approval" stand-in is on. The honesty rules and the audit log back every statement.
- Rules we keep: only authorized agencies send emergency alerts; nothing reaches a resident before a driver accepts; the list of vulnerable residents is sensitive data. `/ready` sign-ups stay unverified until the agent confirms them by phone.

## Sources

- LAist: Despite three 911 calls, two homebound disabled men died in the Eaton Fire waiting for rescue
- KQED: Two homebound disabled men died in the Eaton Fire
- Firehouse / LA Times: UL FSRI findings on the Palisades and Eaton fires
- LA County: Eaton Fire after-action synopsis (McChrystal Group)
- LAist: LA County looks to improve support for vulnerable, older people
- KFF Health News: Disability advocates warn against registry false assurances
- Disability Rights Texas: Let's talk about STEAR
- UN News: Needs of persons with disabilities ignored during disasters
- NBC News: Half of Katrina victims were 75 or older
- Firehouse: Elderly particularly vulnerable during wildfires (Camp Fire)
- Scripps News: Lahaina victims identified
- U.S. Census Bureau: ACS Public Use Microdata Sample documentation (PUMA geography)
- NASA Earthdata: MODIS and VIIRS active fire detection resolution and limitations
- FCC: Declaratory ruling on AI-generated voices under the TCPA (2024)
- UC Berkeley ITS: Understanding California Wildfire Evacuee Behavior and Joint Choice Making
- UC Berkeley TSRC: Review of California Wildfire Evacuations from 2017 to 2019
- Twilio: [Understanding CPS and concurrent call limits](https://support.twilio.com/hc/en-us/articles/40868960307995-Understanding-CPS-and-Concurrent-Call-Limits-in-Twilio)
- MWCOG: [ACS disability status variables, published by tract](https://gis.mwcog.org/wa/rest/services/Hosted/ACS_Disability_Status_Variables_Tract/FeatureServer/0)
