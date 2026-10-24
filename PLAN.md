# Cal Hacks 13.0 plan: assisted evacuation coordination

We connect an evacuation warning to a confirmed, needs-matched ride for people who can't leave on their own. Wildfire is the first demonstration.

| | |
| --- | --- |
| Submissions close | Sun Oct 25, 8:50am Pacific |
| Judging at our table | Sun Oct 25, 10:30am |
| Closing ceremony | Sun Oct 25, 2pm |
| Core-flow gate | Sat Oct 24, 6pm |
| Product name | Open |

## Summary

**The question we answer.** An evacuation warning has gone out. Who still can't leave, and who has actually agreed to pick them up?

**What we demo: Rider Check.** A paratransit agency loads its rider list and draws the warning zone. Our voice agent calls every rider inside it. Answers become dispatch requests, and an optimizer matches each one to a vehicle that can actually do the pickup (space and crew). A dispatcher approves, a driver accepts on their own phone, and only then does the rider get a call back.

**The moment judges remember.** One rider's situation changes. The caller corrects an answer mid-call, and the pickup goes to a crew that can lift. The driver accepts. Then a road closes and the van can no longer reach the rider. The rider is told the truth right away, a stale offer from the old plan is rejected, and a new driver accepts.

**Honesty rule.** Every update reflects the latest confirmed assignment, and the resident hears right away if it changes. Code ties what the agent may say to request status; the prompt doesn't.

**Stability rule.** Re-planning never adds stops to a run a driver has accepted, and never hands an accepted pickup to someone else. A pickup leaves a driver's run only when no route reaches it in time or the driver cancels it.

**Proof standard.** We report dispatch gains against a competent heuristic on identical requests, separately from outreach gains. We report call accuracy per field and failure cases (cancellations, stale acceptances), not only reassurance pressure.

**Where it goes next.** A supervised drill with fictional riders, then a shadow-mode trial alongside an agency's own dispatch. County mode (every household, an alert phone number, all vehicle types) is the roadmap, not the demo.

**Core line.** "The vans were ready at 4am. The call came at 6:03. Nothing connected them."

## How the tracks work together

Four tracks build in parallel. Track A is all of the UI. Tracks B, C and D are backend pieces that never wait on each other: each one builds against the shared Convex contract and the stand-ins already in the repo, then flips its stand-in to Real on the call floor once its own piece writes.

| Track | Owner | Builds | Setup it owns |
| --- | --- | --- | --- |
| A: interface | Boris | Every screen: call floor, rescue map, driver page, under-the-hood screen, simulated phone panel | None |
| B: voice and calls | Brendan | Telephony, the voice agent, dialer, reach ladder, text handling, callbacks | Twilio, Cartesia and Anthropic keys; hosting the call server |
| C: dispatch and simulator | To pick | Road graph, closures, the OR-Tools solver, the heuristic, vehicle movement, the simulator | The shared Convex cloud deployment; deploying the app; hosting the solver service |
| D: modeling and evaluation | To pick | Hazard scenario, door-check queue, address matching, synthetic population, persona cards, the persona eval and grader | None. B and C put every key and URL D needs in the shared env file |

### Rules for every agent and teammate

These are also in `AGENTS.md`, which every coding agent reads.

1. **Commit only to `main`.** Pull with rebase before starting a task and before every commit. Push right after each commit. Never force-push or rewrite history.
2. **Watch `main` for pushes.** Fetch `origin` at least every 5 minutes while working. When new commits land, pull them, read any changed notes addressed to your track, and re-run `npm run typecheck`.
3. **Talk through notes files.** `notes/AtoB.md` holds notes from Track A to Track B, and so on for every pair. Only the sending track writes its file. Add each note at the bottom under a timestamp heading. Reply in your own file to that track.
4. **Change the contract only for tables you own** (see [Contract](#contract)). Write a note to every track that reads the table before pushing the change, and keep old fields working until the readers confirm.
5. **Secrets never go in git.** The shared env file (`CONVEX_URL`, `ANTHROPIC_API_KEY` and the rest) is pinned in the team chat. Save it locally as `.env.local`, which git ignores.
6. **Stand-ins stay working.** Never break a stand-in another track is still building against. Turn yours off with its switch instead of deleting it.

## The problem

In every major disaster for 20 years, the people who die are disproportionately the ones who can't leave on their own, and nothing reliably connects them to the vehicles that could get them out.

**Case study (Eaton Fire, January 2025).** A disabled father who used a wheelchair and his son with cerebral palsy lived in west Altadena. Relatives trying to reach them were turned away at the perimeter. The evacuation order for west Altadena came at 3:25am, and no warning preceded it. Access Services, the county's paratransit provider, said it was ready by 4am and was never called. The father called 911 at 6:03am and again at 6:14, and a relative called at 6:35. The dispatcher said "we have a lot of calls in that area." Both men were found dead around 8:30am. The son needed two or three people to get him out of bed.

> **How we tell this story.** Say "a father and son," not their names. Present it as a coordination failure the reporting supports: vehicles were ready and nobody called. Don't imply our prototype would have saved them, or that reassurance alone explains why they stayed. Our early start is a counterfactual: "What if calls had started as soon as a warning covered their street?"

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

We are assisted evacuation coordination for people with access and functional needs (AFN), with wildfire as the first demonstration. Emergency managers use "AFN," and using it tells a public-safety judge we did our homework. Hurricanes and floods get one line in the close: the pipeline generalizes, but each hazard needs its own operating rules (days of warning and shelter-in-place calls for hurricanes, high-clearance vehicles for floods).

> **Say this.** "Disasters force about 26 million evacuations and displacements a year on average. A warning tells people to leave. It doesn't find out who can't, or confirm that the right vehicle is coming. Only 1 in 5 people with disabilities can evacuate right away without difficulty. We connect the warning to the ride."

The 26 million is roughly the ten-year average of IDMC's disaster displacement count. 2025 had 29.9 million, 13% above that average, and 2024 had 45.8 million. It counts movements, not people, and most happen in Asia. Never put it next to a fire image: wildfires were about 694,000 of the 2025 total. If time is short, drop the global figure and lead with the 1-in-5 number and the Eaton Fire.

**Never call our interface a command center or a dashboard.** It's the rescue map (and the call floor).

### Nearby projects (team awareness only)

Judges may have seen these two Berkeley hackathon projects. We never bring either up first.

| | Orion (Cal Hacks 12) | FirstResponder Relay (UC Berkeley AI Hackathon, June 2026) | Us |
| --- | --- | --- | --- |
| Unit of work | A fire incident | An overflow 911 call | A person who can't get out, matched to a vehicle that can do the pickup |
| Who it reaches | Nobody; commander-facing | Only people who call in | Every registered rider in the zone, by outbound call; silence goes to door checks |
| After intake | Nearest station's units to a fire | A ranked list for the dispatcher | A compatible assignment, dispatcher approval, driver acceptance on the driver's phone |
| When things change | Re-route units | Not addressed | Accepted runs stay put; offers are versioned; residents told right away |
| What residents hear | Nothing | A calming reply right away | Nothing promised until a driver accepts; told immediately if that changes |

If a judge brings one up: "They help responders see the fire or hear the calls that come in. We find the riders who never call, put them on a vehicle that can actually lift them, and only tell them help is coming once a driver has said yes."

## What we're building

One rider's path, from the moment a warning covers their street to the moment they hear who's coming, and what happens when that changes.

1. **Load and target.** The agency uploads its rider list (CSV) with mobility needs already on file. A dispatcher draws the warning zone. Riders inside it enter the call queue, ordered by deadline and known need.
2. **Have a real conversation.** The agent confirms rather than interrogates: are you still at this address, can you leave now, who's with you, has anything changed about mobility or medical needs, and how much help do you need getting out ("two people to lift"). It fills a structured record during the call and reads it back. English and Spanish work end to end. Before hanging up, it asks: "Is there anyone else on your street who might not be able to leave?"
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
- **Hard escalations.** An address the agent can't confirm after two tries, a medical emergency, or "I can see flames" sends the record red to the top of the dispatcher's list, and the agent tells the caller to call 911 if they can. Nobody is just handed back to the line that failed the father and son. Disability advocates review the "if you can leave safely, leave now" script, because it has to work for people who can't.
- **Red-team set.** 25 callers who push for reassurance, plus 10 change cases: a driver cancels, a road closes after acceptance, a stale acceptance of a replaced offer, duplicate events, and a status change while the agent is mid-sentence.
- **Two honesty numbers.** Template-level false promises are zero by construction, so we also measure what can fail. A separate grader model scores how often Claude's free text implies help is coming while status is `received` or `reassigning`, with a human spot check. We also report time from revocation to callback placed and from revocation to template played.

## Contract

One real-time database (Convex) that every track reads and writes. Nobody calls anybody else directly. The schema is `convex/schema.ts`.

> **The hard problem, in one sentence for judges.** "This is dynamic vehicle routing where the deadlines move with the fire, you don't know who needs a ride until you reach them, and every promise has to stay true while the plan changes underneath it." Say it early in every pitch.

**Depth rule.** Every component has one number that survives "how did you set that?" If the honest answer is "we hardcoded it," simplify and say so.

### Tables

| Table | Owner (may change it) | Written by | Read by |
| --- | --- | --- | --- |
| `households` record fields (`canLeave`, `mobility`, `assistanceRequired`, ...) and `corrections` | B | B (`households:update`) | all |
| `households.needProbability`, `fireArrivalAt`, `doorPriority`, location | D | D (`households:setEstimates`, `doorChecks:setPriorities`, `households:setLocation`) | all |
| `households.inZone`, rider import | A | A (`riders:importCsv`, `riders:setZone`) | B, C |
| `calls`, `transcriptLines`, `texts` | B | B; A writes resident replies on the phone panel (`texts:reply`) | A, D |
| `requests` and every status change | C | `convex/requests.ts` only | all |
| `vehicles`, `shelters`, `plans`, `assignments`, `auditLog` | C | C (`plans:propose`, `vehicles:setPositions`); A calls `offers:approve`, `offers:accept`, `offers:decline`, `offers:cancelByDriver` | all |
| `callbacks` | C queues, B places | `offers.ts` queues; B calls `callbacks:markPlaced`, `markPlayed`, `markUnanswered` | A, B |
| `roadClosures` | C | D (hazard), A (manual control), B (resident mentions), C (driver reports) through `roads:addClosures` | all |
| `nominations` | D | B (`nominations:add`), D (`nominations:resolve`) | A |
| `personas` | D | Seed and D only | Stand-ins and D's eval. Real agents must never read it |
| `control` | A | A (stand-in switches) | stand-ins |

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
| `data/sample-riders.csv` | D (A has a starter) | A's upload | `rider_id,name,address,lat,lng,phone,language,mobility,assistance` |
| `data/population.json` | D | C's simulator | Array of `{ id, lat, lng, age, peopleCount, mobility, assistanceRequired, medical, hasCar, canLeave, answersPhone, language }` |
| `data/hazard/scenario.geojson` | D | C's simulator, A's map | Polygons with a `minutesAfterWarning` property |
| `data/personas.json` | D | D's eval, B's tests | Array of persona cards with `truth` (as in the `personas` table) and an optional `correction` |
| Text agent endpoint | B | D's eval | `POST /turn` with `{ sessionId, language, text }` returns `{ reply, stage, record, done }` |

Until a file exists, its reader uses a stand-in: C generates a population from `convex/seed.ts`, A and C use the radial stand-in fire in `convex/model.ts`, and D's eval runs against its own scripted agent behind the same endpoint shape.

### Stand-ins already running

Press **Issue evacuation warning** on the call floor. That seeds 200 simulated households, 8 vehicles (Maria's and Luis's vans are left for the driver page) and one shelter, then starts the loop. Each switch on the call floor turns one stand-in off.

| Switch | Fakes | Owner |
| --- | --- | --- |
| Voice agent, dialer and callbacks | Rings, scripted calls in English and Spanish, retries, texts and replies, callbacks heard | B |
| Dispatcher and vehicle movement | Nearest compatible free vehicle for each waiting request, vehicles driving to pickups | C |
| Drivers not on the driver page | Simulated drivers accept their offers after 6 seconds | C |
| Dispatcher approval | Approves every proposed offer at once | A |
| Need model | Census prior shrunk toward nearby answered calls | D |

## Track A: interface (Boris)

Every screen, built against the stand-ins. No setup.

**Rescue map** at `app/map/page.tsx`, reusing `components/ui` and the tokens in `app/globals.css`.

- Requests (`requests:open`), vehicles (`vehicles:list`), accepted runs and open offers (`offers:active`), closures (`roads:closures`), the zone (`riders:currentZone`), door-check order (`doorChecks:queue`) and nominations (`nominations:open`).
- Red escalations at the top of the list.
- One-click approval of proposed offers (`offers:approve`). Turn off "Dispatcher approval" to use it.
- CSV upload (`riders:importCsv`) and zone drawing (`riders:setZone`).
- The plan version and solve time from `plans:latest`.

**Driver page.** A phone-sized page with a driver picker, so one phone can act as any driver. It shows the driver's accepted run in stop order and open offers (`offers:forVehicle`), with Accept, Decline and "Can't make it" (`offers:cancelByDriver`). A `"changed"` result from `offers:accept` shows "This assignment changed."

**Under-the-hood screen.** Architecture, latency p50 and p95, per-field accuracy, honesty numbers, simulator results with ranges, and the audit trail (`plans:auditTrail`). It holds the "Close this road" control, which writes a `manual` closure through `roads:addClosures` so the demo's closure lands on cue. Every re-plan shows requests, vehicles, solve time, plan version and changed offers. Every simulator number shows a range. Simulated vehicle positions are labeled as simulated.

**Simulated phone panel.** The text channel (`texts:recent`, `texts:forHousehold`), with a reply box that writes `texts:reply`. It's labeled as simulated.

**Call floor.** Already built. Keep it working as the contract grows.

**Before the gate:** rescue map with approval, driver page on a second phone, CSV upload and zone drawing, the "Close this road" control, and the phone panel.

**After the gate:** the full under-the-hood screen and the Auth0 add-on (dispatcher login, role-based access to the at-risk list, step-up authentication once per session so approval stays one click).

## Track B: voice and calls (Brendan)

Hands off to: `households`, `calls`, `transcriptLines`, `texts`, `nominations`; places the calls in `callbacks`.

**Setup this track owns.** Take Twilio off trial, buy the number and request a higher call rate. Get Cartesia and Anthropic keys. Host the call server at a public URL (Twilio Media Streams needs a WebSocket server, which Convex can't host). Put `ANTHROPIC_API_KEY` in the shared env file for Track D.

**Telephony.** Twilio Programmable Voice. Each call streams 8 kHz μ-law audio over Media Streams to the call server, one async session per call.

**Speech loop.** Streaming speech-to-text, then Claude, then Cartesia for the voice. Use Cartesia's speech-to-text if it holds up on 8 kHz phone audio, so Cartesia carries both directions; otherwise use another streaming speech-to-text and say so in the README. Voice activity detection handles turn-taking and interruptions.

**Who decides what.** Claude interprets messy speech and phrases replies. A deterministic state machine decides what to ask next and what may be promised. Don't weaken that split to make Claude look more autonomous, because it's our answer to Anthropic's "where could it go wrong."

**Corrections.** Every field in the record carries a confidence. Send corrected fields through `households:update`; the contract logs the correction and drops offers the vehicle can no longer serve. The read-back before hanging up ("two people, one wheelchair, needs two people to lift, 100 Terrace St, is that right?") is where most corrections land.

**Languages.** English and Spanish end to end, covering recognition, extraction, voice and templates. Don't claim "any language."

**Model and latency.** Haiku 4.5 (`claude-haiku-4-5-20251001`) runs the turns. Switch to Sonnet 5.5 (`claude-sonnet-5-5`) only if Haiku misses corrections in the persona eval. The budget is under 1 second per turn: stream Claude's text to Cartesia sentence by sentence, make record writes fire-and-forget, and cover tool calls with a short backchannel ("okay, got it"). Log per-turn latency so Track A can show p50 and p95.

**Outbound dialer.** Calls `households:queue` (in-zone households only, highest priority first), drained by a token bucket sized to Twilio's default of 1 call per second. A 200-rider zone takes about 3.5 minutes to dial. Answering-machine detection leaves a short voicemail and schedules a retry.

**Reach ladder.** Call, retry at 2 minutes, retry at 5, text, door-check queue (`calls:end` and `calls:resolveFollowUp`). Status callbacks use the same ladder; an unanswered `reassigning` call is retried and then texted.

**Text fallback.** After two failed voice attempts, send a text with numbered replies (`texts:send`) and parse replies from `texts` with Claude. SMS registration won't clear this weekend, so texts live in Convex and show on Track A's simulated phone panel.

**Live status during calls.** Subscribe to `requests:forHousehold` for the length of a call. When status changes, interrupt at the next sentence boundary and play the new template. Write `requestStatus` on every agent line in `transcriptLines` so the grader can check it.

**Callbacks.** Subscribe to `callbacks:pending`, place each call, then mark it placed, played or unanswered.

**Neighbor question.** Write spoken addresses to `nominations:add`.

**Inbound callers.** `households:findOrCreateByPhone` returns a household; unknown numbers get one with no location, flagged for an address check.

**Hard escalations.** `requests:escalate` with `medical`, `flames` or `address_unconfirmed`.

**Text agent endpoint** for Track D's eval: `POST /turn` with `{ sessionId, language, text }` returns `{ reply, stage, record, done }`, running the same state machine and prompt as phone calls.

**Test without the other tracks.** Turn off the voice stand-in. The seeded households give you a queue, and the dispatch stand-in produces `callbacks`. To drive a status change mid-call, call `offers:accept` or `offers:cancelByDriver` from `npx convex run`.

**Before the gate:** real calls fill household records on the call floor, corrections reach the record, English and Spanish work, honesty templates (including `reassigning`) play by status, status changes interrupt live calls, callbacks play, and latency is logged.

**After the gate:** the full red-team set (with Track D's grader) and the audio eval.

## Track C: dispatch and simulator

Hands off to: rescue map (plans, offers, vehicles), Track B (status changes, callbacks).

**Setup this track owns.** Create the shared Convex cloud deployment (`npx convex login`, then `npx convex dev`) and invite the team. Put `CONVEX_URL` in the shared env file. Deploy the Next app so the driver page opens on a phone. Host the Python solver service at a public URL for Convex actions to call. All of this is live by 12pm Saturday.

**Road network.** OpenStreetMap through OSMnx: edges with length, speed limit and lanes, and free-flow travel times. Snap closures from `roadClosures` to edges (`roads:setEdgeKey`). Closures come from Track D's hazard, drivers' reports ("Lincoln Ave blocked"), residents' mentions on calls (unconfirmed until checked) and the manual control. Dijkstra on the west Altadena graph takes milliseconds, so recompute every vehicle, request and shelter path on each change.

**Dispatch optimizer.** A dynamic dial-a-ride problem: a mixed fleet, pickups and drop-offs, deadlines, re-solved whenever the world changes. Reads `requests:open`, `vehicles:list`, `offers:active` and `roads:closures`; writes through `plans:propose`.

- *Requests:* pickup node, eligible shelters (any one), load vector, crew needed, lift needed, boarding time (about 2 minutes walking, 5 with a walker, 10 in a wheelchair, 20 bedbound or two-person lift), deadline and weight. All but the nodes are already on `requests`.
- *Vehicles:* position, passengers on board, capacity vector, crew size, lift capability, shift end, and the accepted run it's on.
- *Objective,* with costs scaled to integers for OR-Tools:

  ```
  w_r     = v_r / max(slack_r, 2 min)        slack_r = L_r − earliest arrival_r
  minimize  Σ_k time_k  +  λ Σ_r lateness_r  +  ν · changed open offers  +  Σ_r w_r · dropped_r
  ```

  Deadlines are soft upper bounds on the time dimension (`SetCumulVarSoftUpperBound`), so λ prices lateness. A request that can't be served at all is dropped at a cost of its weight.
- *Constraints:* pickup before drop-off on the same vehicle, capacity per dimension, crew and lift compatibility, maximum ride time for oxygen users, shelter capacity, and accepted runs frozen.
- *Solver:* OR-Tools Routing with pickup-and-delivery pairs, eligible shelters as a disjunction, three capacity dimensions plus a time dimension, compatibility as allowed-vehicle sets, and each request optional with its drop penalty. Parallel cheapest insertion, then guided local search, with a 3-second limit.
- *Re-planning:* event-driven, debounced to every 5 to 10 seconds, warm-started from the current plan. Open offers the new plan keeps aren't touched, so a driver always gets the full 2 minutes to respond. Changed ones go in `replace`.
- *Escalation:* requests the solver can't serve in time get `requests:escalate` with `unservable`.

**Accepted runs don't change.** Once a driver accepts, their accepted stops and the order of those stops are fixed. A driver halfway through picking up three evacuees finishes that run before anything new reaches them.

- The solver never moves an accepted pickup to another vehicle or inserts a pickup into an accepted run. A vehicle gets new offers only for stops after its last accepted drop-off. The contract refuses anything else.
- When a road closes, the solver re-routes the same vehicle to the same stops.
- An accepted pickup goes in `revoke` only when no route reaches it before its deadline. The rest of that driver's run stays as accepted.
- The ν penalty applies only to open offers, so re-solves don't churn offers a driver is still looking at.

**Vehicle movement and ETAs.** Move simulated vehicles along road paths (`vehicles:setPositions`), move requests to `en_route` and `arrived`, and keep `etaMinutes` current. Replace the straight-line movement in `convex/dispatchStandIn.ts`.

**Competent heuristic.** Earliest deadline first, type and crew matched, greedy insertion after each vehicle's accepted run. It's the baseline we must beat and the fallback dispatcher if the solver service fails.

**Simulator.** A discrete-event simulation (SimPy) of a night: the hazard advances, calls are answered or missed, vehicles drive, roads close and drivers sometimes cancel. Every assumption is labeled.

- Three policies on identical scenarios: today's process (911 first come, first served, nearest unit, radio delays; context only), the competent heuristic, and ours.
- Three separate results. *Dispatch only:* both dispatchers get identical requests at identical times, which is the honest optimizer number. *Outreach only:* the heuristic dispatcher with requests arriving when our calls would surface them. *Combined.*
- Metric: additional simulated pickups completed before the scenario deadline, plus worst wait, wait for wheelchair and bedbound riders, and vehicle-minutes. About 100 seeds, reported with ranges. Never "lives saved."
- Expect a modest dispatch gap; single digits to low double digits is a good result. Script it now: "A good dispatcher with a whiteboard does fine when it's quiet. The gap opens when [the fleet is tight / closures stack up]; here's by how much."
- Sensitivity panel: fleet size, answer rate and hazard speed, plus one honest line about where we don't help (for example, below a certain fleet size nothing reaches the last households in time).
- Ground truth comes from `data/population.json`. The simulator evaluates a policy; it doesn't validate predictions about real households, and the screen says so. Write results to `data/sim-results.json` for Track A.

**Test without the other tracks.** The voice stand-in fills households and requests; the radial stand-in fire gives deadlines; add closures yourself with `roads:addClosures`.

**Before the gate:** the solver writing compatible offers through `plans:propose`, re-routing around closures, revocation when a pickup becomes unreachable, the heuristic running as fallback, and vehicle movement.

**After the gate:** simulator results with the three-way split and the sensitivity panel. Then congestion and departure timing as labeled exploration ("What happens if everyone leaves at once?"):

- Edge travel time from the BPR curve, t = t₀ (1 + 0.15 (v/c)⁴), with residents who drive loaded onto the network by departure time.
- Departures from a drift-diffusion model, dX = μ(t) dt + σ dW, leaving when X crosses a threshold. Two classes (evacuation-keen and evacuation-reluctant, per Berkeley's survey of California evacuees), with shape fit to published departure curves.
- The effect of a phone call on departure is an assumption explored in simulation, not a finding. Skip the time-expanded min-cost flow and the coupling loop unless everything else is done.

## Track D: modeling and evaluation

Hands off to: Track C (population, hazard file), field teams (door order), Track A (sample CSV), Track B (personas, nomination matches).

**No setup.** `CONVEX_URL` and `ANTHROPIC_API_KEY` arrive in the shared env file from Tracks C and B. Until then, work on files. Call Convex from Python with `pip install convex`.

**Sample rider list.** Replace the starter `data/sample-riders.csv` with about 40 fictional riders at real west Altadena address points, including Carmen and Walter for the demo.

**Hazard scenario.** Labeled scenario polygons by time over the real west Altadena road graph, drawn from the published progression timeline, saved as `data/hazard/scenario.geojson`. A runner script advances it during a session: it writes each household's `fireArrivalAt` through `households:setEstimates` and adds a `hazard` closure through `roads:addClosures` when a polygon reaches a road within a safety margin. On screen: "Scenario input, not a forecast." The hazard never marks anyone safe: an unanswered household is always unknown. Say this unprompted.

**Door-check queue.** Calls scale, but door-knock teams don't: with 6 teams and 400 unreached homes, order matters. The queue is a transparent score, written through `doorChecks:setPriorities`.

```
priority_h = (p_h · u_h) / τ_h + α · wait_h
```

- `p_h` is the need estimate. Known need from the rider list or a call comes first, and a neighbor nomination raises it sharply. Otherwise it's the census base rate: age 65+, no vehicle and 65+ living alone by block group, and disability by tract, since ACS publishes disability status (table B18101) only down to the tract. Spatial smoothing from answered neighbors is one term we can switch on and off on screen.
- `u_h` is urgency from the hazard deadline, and `τ_h` is travel time for the nearest team (compute it with OSMnx yourself; don't wait on Track C).
- `wait_h` is minutes on the list. This aging term guarantees no household, however isolated, stays last forever. State how α was set.
- Guardrails: the score only orders visits and nobody is skipped because of it. Estimates are shown as estimates, and no individual risk scores appear on screen.

**Address matching.** Match `nominations:open` and unlocated inbound callers against OSM address points in the zone. Write matches with `households:setLocation` and `nominations:resolve`; unmatched nominations stay flagged for the dispatcher.

**Synthetic population.** The standard method, as in PopGen and ActivitySim: draw real ACS PUMS household records from the PUMA(s) covering Altadena, then reweight them with iterative proportional fitting. Fit age, vehicles and living alone to block-group totals and disability to tract totals. Because whole real records are resampled, the dangerous combinations (75+, ambulatory difficulty, alone, no car) survive. Place households onto real building footprints, clustered around real senior housing and care facilities from OpenStreetMap. Save as `data/population.json`. It feeds simulator ground truth, the persona cards and the door-check base rates.

**Persona cards.** About 200 in `data/personas.json`: hard of hearing, partial address, panic, Spanish, tangents, a second voice and mid-call corrections.

**Persona eval.** Runs each card against the text agent endpoint. Until Track B's endpoint is up, run against your own scripted agent with the same request and response shape. Report accuracy separately for address, passenger count, mobility and assistance required, plus correction success rate and completion time, to `data/eval-results.json` for Track A.

**Implied-reassurance grader.** A separate grader model reads agent lines with their `requestStatus` and flags implied promises, with a human spot check.

**Before the gate:** the sample rider list, the hazard runner writing deadlines and closures, the door-check score with the smoothing toggle, address matching, and persona cards with corrections.

**After the gate**, in order:

1. Door-check fairness tests in your own door-team simulation: 30% of nominations wrong, one neighborhood answering at half the rate, and isolated homes with no answering neighbors. Report worst-case time to check, not only the average, against random and nearest-first orderings.
2. A simple spread model as a scenario generator: wind-driven elliptical spread with fast marching (scikit-fmm) on a uniform fuel grid, so closures emerge from simulated spread instead of a script. Claim "conservative within our assumptions," never "validated against satellite data": MODIS and VIIRS detections are about 1 km and 375 m, intermittent, and blocked by smoke. Film the video before starting this.

## Team work outside the tracks

These need an owner each at the next sync.

- **Practitioner conversation (highest priority).** An Access Services dispatcher or manager, a paratransit driver, or an emergency manager. Ask how an assignment would reach a driver today, who is allowed to approve, and what would make them distrust this.
- **Advocates.** Disability Rights California, an LA independent living center, LA County CERT. Ask each one question: what would make you trust or distrust an AI agent calling people during an evacuation? Their answer shapes the "if you can leave safely" script.
- **Usability tests.** 5 to 10 older adults playing persona cards, recorded with permission.
- **Pitch script, demo rehearsal and the Devpost video (Brendan, alongside Track B).** The pitch runs from a `/present` page in this app, so slides can show the live rescue map and call floor. Brendan owns `app/present/`; Track A keeps the shared components and tokens it reuses working.
- **Notability notes,** only if they're kept as we go.

## Timeline

The core flow must work end to end by Saturday 6pm. Everything after that is extras, evidence and polish.

| When | What |
| --- | --- |
| Sat now to 12pm | Tracks B and C finish their setup and share the env file. Every track builds its "before the gate" list against the stand-ins. Usability calls with older relatives once the voice loop answers. Chase one practitioner conversation and ask mentors with public-safety backgrounds for 10 minutes. |
| Sat 12pm to 6pm | Flip stand-ins to Real one at a time and run Rider Check end to end: CSV, call, correction, compatible offer, approval, driver acceptance on a second phone, callback, closure, revocation, `reassigning` call, stale offer rejected, new acceptance. |
| **Sat 6pm** | **Gate: the core flow works end to end** |
| Sat 6pm to Sun 2am | Extras in order (below), add-ons in parallel. Film the video before the spread model. Add-ons get one owner and a one-hour timebox each. |
| Sun 2am to 8:30am | Feature freeze at 4am. Edit the video, write Devpost and READMEs, rehearse both pitch versions and the Q&A, opt into every track. |
| Sun 8:50am | Submitted on Devpost |
| Sun 10:30am | Judging at our table |

**The 6pm gate includes:** the full Rider Check flow, honesty states including `reassigning`, corrections reaching open offers, frozen accepted runs, stale-acceptance rejection, the competent heuristic running as fallback, and measured latency. If the core isn't working at 6pm, drop every extra and spend the night on reliability and backups.

**Extras after the gate, in order:**

1. Simulator results with the dispatch, outreach and combined split, and the sensitivity panel (C, shown by A)
2. Audio eval and the full red-team set, including the 10 change cases and the implied-reassurance grader (B, D)
3. Door-check fairness tests (D)
4. Simple spread model as a scenario generator (D), after the video is filmed
5. Congestion and departure timing exploration (C)

## Evaluation

Call quality is reported per field.

1. **Persona eval (scale).** The 200 text personas from Track D.
2. **Audio eval.** About 30 synthetic-voice callers from a different TTS provider (so we don't test Cartesia against itself) calling our real Twilio number, with noise and slow speech. Report the drop from text.
3. **Usability tests.** Ask what confused people, whether they trusted it and whether they'd have left. Fix one thing and re-test one person. Present these honestly as usability tests, not as evidence about riders or dispatchers.

**Where to push for impressiveness**, in order: the change moment; the compatibility moment (the lift pickup goes to a two-person crew); the correction moment; honesty numbers; the dispatch-only result with ranges and the line about where we don't help; per-field call accuracy; measured latency; door-check fairness.

## Demo

One rider whose situation changes, handled correctly the whole way through, in about 3 minutes in a loud room.

### Table setup

- **Big screen:** the rescue map over the real west Altadena street grid, with the hazard labeled "scenario input."
- **Rider CSV** of fictional riders, ready to import, and a zone to draw.
- **2 or 3 rider phones** with persona cards that include a correction. Example: "Carmen, 79, speaks Spanish. You first say it's just you. Then you remember your son is home: he uses a wheelchair and needs two people to lift him." We hand the judge one of these phones and never enter a judge's own number.
- **Driver phone** held by a teammate, on the driver page. Maria's van gets Carmen's offer, and Luis's van has an open offer for a second rider, Walter.
- **Solver panel** that updates on every re-plan: "Plan v5, 12 vehicles, 46 requests, 1.8s, 2 offers changed, 1 stale acceptance rejected."
- **Under-the-hood screen** with the "Close this road" control.

Rehearse with a fixed seed so the same vans, offers and closure come up every time.

### The 3-minute script

1. **0:00 Story.** A father and son. The order came at 3:25am with no warning first. Vans were ready at 4am, and nobody called. Three 911 calls followed, starting at 6:03. "We can't say what would have saved them. We can build the connection that was missing."
2. **0:20 Counterfactual.** "What if the paratransit agency started calling its riders the moment a warning covered their street?" Import the CSV, draw the zone, and the calls start.
3. **0:35 The call.** The judge answers as Carmen, in Spanish or English. Midway they correct themselves: the son is home, uses a wheelchair and needs a two-person lift. The record changes on screen. They ask "Is someone coming?" The agent says: "Not yet. You're on the list as high priority, and I'll call back the moment a driver accepts."
4. **1:05 Technical line and compatibility.** "Under the hood, this is vehicle routing where deadlines move with the fire and the promises have to stay true while the plan changes." Maria's two-person crew gets the offer. The dispatcher approves it. "Approval isn't a promise, so Carmen hears nothing yet."
5. **1:30 Acceptance.** The teammate, as Maria, taps Accept. Carmen's phone rings: "A wheelchair-accessible van with a two-person crew is 6 minutes away. The driver's name is Maria."
6. **1:50 The change.** We close the only road between Maria and Carmen. No route reaches Carmen in time, so plan v5 revokes that one pickup. The rest of Maria's run stays as it was. Carmen's phone rings: "Your driver can no longer reach you. You're still at the top of the list." Plan v5 gives Luis's van to Carmen instead of Walter. The teammate switches to Luis and taps Accept on the old Walter offer, which is rejected on screen ("This assignment changed"). Luis accepts Carmen, and her phone rings with the new driver.
7. **2:20 Proof.** Dispatch-only gain over the competent heuristic on identical requests, with ranges; per-field call accuracy; honesty results including revocation cases; what a practitioner told us and what we changed. Simulation is labeled as simulation.
8. **2:45 Close.** "Ready for a supervised drill on fictional riders, then shadow mode beside an agency's dispatchers. Wildfire is the first hazard; floods and hurricanes need their own rules on the same pipeline." Last line: "The vans were ready at 4am. The call came at 6:03. We connect them."

### The 2-minute version (demo first, story last)

For Cartesia's format and quick-visit judges.

1. **0:00** The phone rings, and the judge plays Carmen, including the correction and the honest "not yet" (about 35 seconds).
2. **0:35** Two-person crew gets the offer; approval; Maria accepts; callback.
3. **1:05** Road closes; Carmen's pickup revoked while the rest of Maria's run stays; `reassigning` call; stale Walter offer rejected; Luis accepts.
4. **1:35** One line of story; what Cartesia does in the pipeline (both directions, if speech-to-text holds); latency; per-field accuracy; known limitations.
5. **1:55** "Ready for a supervised drill on a paratransit rider list."

**Devpost video (3 minutes max).** Open on a dark room and a ringing landline, then cut to the rescue map and run the same single-rider flow. Film Saturday night, before the spread model and congestion work.

### Q&A prep

| Question | Answer |
| --- | --- |
| "A driver accepts an offer the plan already replaced. What happens?" | Show it: the accept is rejected atomically, no callback fires, and the audit trail shows v4 replaced by v5. |
| "Does re-planning yank drivers around?" | No. An accepted run is fixed, and a driver only gets new offers after their last accepted drop-off. A pickup is revoked only when no route reaches it in time or the driver cancels. |
| "What if the person isn't sure, or changes their answer?" | Corrections overwrite the field, re-run compatibility and are measured (correction success rate in the persona eval). |
| "Would this have saved the father and son?" | "We can't say that. The reporting shows vans ready and nobody called. We built that missing connection; whether it saves a given life depends on things we don't control." |
| "Is your fire model validated?" | "It's a scenario input. Satellite detections can't validate arrival times at individual homes, so we don't claim that." |
| "Don't isolated households always end up last?" | The waiting-time term ages every household up the list. Show the worst-case result from the fairness test. |
| "Isn't the simulator grading its own homework?" | Ground truth comes from real census records reweighted to real totals. It evaluates a policy, not a prediction, and we say so on screen. |
| "How does this scale to other agencies?" | Each agency runs its own instance on its own riders. Across agencies, a shared need model could improve through federated training without raw data leaving any agency. We haven't built that. |
| "Isn't AI calling people regulated?" | The FCC ruled in 2024 that AI-generated voices count as "artificial voice" under the TCPA. The agency calls its own riders for an emergency purpose, which falls under the TCPA's emergency exception. Agency counsel would confirm before any real deployment. |
| "Why voice instead of an app?" | Nobody installs anything during an evacuation. Landlines and flip phones work, and riders who can't use screens can still answer. |

## Customers and the path to production

The goal is one sentence: "We asked X. A dispatcher told us Y. We changed Z."

- **Customer:** paratransit agencies like Access Services first, county emergency management later.
- **Users:** riders who can't leave on their own, the agency's dispatchers and its drivers.
- Even one real practitioner conversation moves Anthropic, Microsoft and People-First judges more than any model.
- Approach Altadena residents only with care; fire survivors don't owe us their time.
- Report exactly what we got, for example "1 dispatcher call, 2 advocate replies, 8 usability tests with adults 70+." Real but small beats impressive but inflated.

**Path to production.**

1. A supervised drill with one agency, fictional riders, and its own dispatchers at the controls.
2. Shadow mode during real warnings: the system builds plans alongside the agency's dispatch, and we compare without calling anyone.
3. A pilot on the agency's real rider list under its authority. County mode only after this works.

| A forward-deployed engineer asks | Our answer |
| --- | --- |
| Who authorizes the calls and assignments? | The agency. The rescue map is their dispatcher's screen, and nothing goes out without their approval. |
| Who handles urgent escalations? | The agency's dispatcher, with red records at the top of the list and a handoff to 911. |
| How do assignments reach drivers? | A link on the driver's phone this weekend; their existing driver tablets later. |
| What if a rider needs more help than a vehicle can give? | Compatibility blocks it. If nothing compatible exists in time, it escalates to fire or EMS. |
| What happens when calls, location feeds or the solver fail? | Text fallback, the heuristic dispatcher, an exportable call list, and the audit log showing what was said. |
| Integrations? | CSV or rider-database export, the agency's vehicle GPS feed, driver acceptance, escalation to 911. |

## Responsible design

- Fictional riders in every demo. Real data only under the agency's authority, deleted when the incident closes.
- Role-based access is part of the pitch only if the Auth0 add-on ships.
- No individual risk scores on screen. A human approves every plan. The honesty rules and the audit log back every statement.
- Rules we keep: only authorized agencies send emergency alerts; a human approves every plan; nothing reaches a resident before a driver accepts; the list of vulnerable residents is sensitive data, with no public intake endpoint.

## Prize tracks

Each track gets work a judge can see, and every sponsor tool gets a README line saying where it runs. Nothing below Core is touched before the 6pm gate. Each add-on has one owner and a one-hour timebox, and whatever isn't working by then stays out of the demo.

| Track | Prize | What the judge must see | Tier |
| --- | --- | --- | --- |
| Cal Hacks: Overall, Most Technically Complex, People-First | MacBook Air down to Apple Watch | People-First is our clearest fit. Most Technically Complex comes from dispatch staying correct under changing constraints, shown live on the under-the-hood screen. | Core |
| Cartesia | Meta glasses (to be confirmed) | Voice is core. One complete flow including a correction and an interruption, per-field accuracy, latency and Spanish. The 2-minute demo-first version, and a README listing Cartesia features used and known limitations. | Core |
| Convex | $5,000 | Correctness under conflicting events: version-checked acceptance, idempotent callbacks, revocation, the reach ladder and the audit log. Show the stale acceptance rejected live, the v4 to v5 audit trail, and a duplicate event producing no second call. | Core |
| Anthropic | Not posted yet | A named community (paratransit riders in LA County wildfire zones) and a real problem (what a practitioner told us). One flow done well. Claude interprets messy, corrected speech in two languages, code controls every commitment, and we show where Claude could go wrong (implied reassurance, measured). | Core |
| Microsoft: Built for the Real World, Customer Impact | Surface each | The forward-deployed Q&A table, the three-phase path, the dispatch-only result, responsible design and the full flow end to end. Strongest if a practitioner conversation happened. | Core |
| Apify: Best Actor | $400 | A public "California evacuation status" Actor that normalizes county and state evacuation zones and road closures and triggers Rider Check when a zone with riders goes to warning. It should be useful to others on its own. | After gate |
| MLH: Auth0 | Headphones each | Dispatcher login, role-based access to the at-risk list, and step-up authentication once per session. | After gate |
| Notability | 1 year Pro | Notes kept as we go: sketches, mentor feedback as audio, decisions as they happened. Notes added after the fact score zero. | After gate |
| Figma | Verify at the event | Keep the stage log only if it's already running. | Opt-in |
| Planet-First, Hacker's Choice, MLH opt-ins (domain, Gen AI, hosting, Commit Fellowship) | Assorted | Opt in on Devpost; no extra build work. | Opt-in |

## Risks and backups

| Risk | Backup |
| --- | --- |
| Scope creep | The gate decides. Extras only after 6pm, in the stated order. |
| Tracks drift apart | One contract in Convex, notes files between tracks, everyone on `main` |
| The agent promises help that isn't coming | Statuses in code, ETAs only by template, the implied-reassurance grader, and the red-team set run before the demo |
| A promise becomes false after acceptance | Re-route first, then `reassigning` status, revocation and measured time to notify |
| Re-planning churns drivers | Accepted runs frozen in the contract; only open offers can change, at a cost |
| A correction doesn't reach the open offer | Correction cases in the persona eval; the contract re-checks compatibility on every record change |
| No practitioner conversation by Sunday | Mentors with public-safety backgrounds at the event. Report exactly what we got, and don't present usability tests as customer evidence. |
| Dispatch gain over the heuristic is small | Script the honest version, show where the gap opens, and lead with correctness rather than margin |
| Cartesia speech-to-text fails on 8 kHz audio | Another streaming speech-to-text; Cartesia stays the voice, and the README says so |
| SMS registration doesn't clear | Expected. Texts run on the simulated phone panel, labeled. |
| Twilio rate limits or spam flagging | Dialer sized to 1 call per second; demo on team-owned phones |
| Loud room | Phone to the ear; live transcript on screen |
| Voice latency over 1 second | Haiku 4.5 for turns, sentence streaming, fire-and-forget writes, backchannel |
| Voice or venue wifi fails live | Phone hotspot, recorded calls and the pre-recorded video |
| Overclaiming the case study or the impact | Counterfactual framing; "additional simulated pickups," never lives saved; every simulated number labeled |
| "Isn't AI calling people regulated?" | The TCPA emergency-purpose answer |
| Exposing the at-risk list | Fictional riders only, deletion on incident close, no public intake endpoint |

## Open decisions

- Product name
- Owners for Tracks C and D, and for the rest of the team work outside the tracks
- Whether Cartesia's speech-to-text holds up on 8 kHz phone audio
- Which neighbor-question and "can't leave" wording residents and advocates find natural
- Who plays the driver at the table (they need to be free for the whole judging window)

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
- IDMC: Global Report on Internal Displacement 2026 (summary); NRC press release, May 2026
- U.S. Census Bureau: ACS Public Use Microdata Sample documentation (PUMA geography)
- NASA Earthdata: MODIS and VIIRS active fire detection resolution and limitations
- FCC: Declaratory ruling on AI-generated voices under the TCPA (2024)
- Cal Hacks 13.0 live prize feed (hive.hackberkeley.org), checked Oct 24, 2026
- UC Berkeley ITS: Understanding California Wildfire Evacuee Behavior and Joint Choice Making
- UC Berkeley TSRC: Review of California Wildfire Evacuations from 2017 to 2019
- Twilio: [Understanding CPS and concurrent call limits](https://support.twilio.com/hc/en-us/articles/40868960307995-Understanding-CPS-and-Concurrent-Call-Limits-in-Twilio)
- Twilio: [A2P 10DLC campaign registration changelog](https://www.twilio.com/en-us/changelog/a2p-10dlc-campaign-registration-will-require-privacy-policy-and-)
- MWCOG: [ACS disability status variables, published by tract](https://gis.mwcog.org/wa/rest/services/Hosted/ACS_Disability_Status_Variables_Tract/FeatureServer/0)
