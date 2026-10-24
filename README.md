# Standard Response

Evacuation calling and dispatch for Cal Hacks 13.0. `PLAN.md` has the plan, the four tracks and the contract. This repo holds the shared Convex contract, stand-ins for every backend piece, and the call floor.

> Warning: everything the stand-ins produce is simulated. Never show a stand-in number to judges as a real result.

## Run it

```bash
npm install
npm run dev:backend   # Convex. Use the team's cloud deployment from the shared env file
npm run dev           # http://localhost:3000
```

Open the page and press **Issue evacuation warning**. That seeds 200 simulated households in west Altadena, 8 vehicles and a shelter, then starts the stand-in dialer, voice agent, need model, dispatcher and drivers.

**Shared backend.** Track C creates the team's cloud deployment (`npx convex login`, then `npx convex dev`) and shares `CONVEX_URL`. Everyone else runs `npx convex dev` against that project.

## How the pieces connect

```
 voice (Track B) ──── households:update, calls:*, texts:*, callbacks:mark* ───┐
 dispatch (Track C) ── plans:propose, vehicles:setPositions, roads:* ──────────┤   Convex tables     ├──► every screen (Track A)
 models (Track D) ──── households:setEstimates, doorChecks:*, roads:addClosures┘  (convex/schema.ts)
```

Every service talks only to Convex. Nobody calls anybody else directly, so nobody waits on anybody. `PLAN.md` under "Contract" lists who owns and writes each table.

## Calling Convex from Python

```bash
pip install convex
```

```python
from convex import ConvexClient
client = ConvexClient(os.environ["CONVEX_URL"])

# Voice (Track B)
call_id = client.mutation("calls:start", {"householdId": hid, "direction": "outbound"})
client.mutation("calls:say", {"callId": call_id, "speaker": "resident", "text": "No, I can't get out."})
client.mutation("households:update", {"householdId": hid, "patch": {"canLeave": "no", "assistanceRequired": "two_person_lift"}})
for request in client.subscribe("requests:forHousehold", {"householdId": hid}):  # status drives what may be said
    ...
for pending in client.subscribe("callbacks:pending", {}):
    ...

# Dispatch (Track C)
for requests in client.subscribe("requests:open", {}):  # re-plan on every change
    client.mutation("plans:propose", {"solver": "ortools", "solveMs": 1800, "offers": [...], "replace": [], "revoke": []})

# Models (Track D)
client.mutation("households:setEstimates", {"estimates": [{"householdId": hid, "needProbability": 0.61, "fireArrivalAt": eta_ms}]})
client.mutation("roads:addClosures", {"closures": [{"path": [{"lat": 34.19, "lng": -118.15}, {"lat": 34.191, "lng": -118.15}], "source": "hazard"}]})
client.mutation("doorChecks:setPriorities", {"scores": [{"householdId": hid, "doorPriority": 4.2}]})
```

## Voice server (Track B)

`voice/` is the call server: Twilio Media Streams in, Cartesia speech-to-text, Claude, Cartesia voice out. It talks only to Convex. It calls real riders (`simulated: false`, the CSV import); the voice stand-in keeps handling the simulated households.

```bash
npm run dev:voice    # http://localhost:8080, reads .env.local
```

| Variable | What it is |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude, which interprets each thing a resident says |
| `CARTESIA_API_KEY`, `CARTESIA_VOICE_EN`, `CARTESIA_VOICE_ES` | Speech in both directions, and the English and Spanish voices |
| `CARTESIA_VOICE_ZH`, `_KO`, `_VI`, `_TL`, `_RU`, `_JA` (optional) | Native voices for the other call languages; each falls back to the English voice, which Sonic can make speak any of them |
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_FROM_NUMBER` | Telephony. Calls are placed with the API key |
| `TWILIO_AUTH_TOKEN` | Checks the signature on every Twilio webhook |
| `VOICE_PUBLIC_URL` | Public https URL of this server; Twilio calls back here |
| `DIAL_ALLOWLIST` | Comma-separated numbers the dialer may ring. Every other number is skipped, so a fictional rider list never rings a stranger |
| `TWILIO_TRIAL` | `true` on a trial account. Twilio then plays its notice and waits for a key press before our agent speaks, so answering-machine detection is turned off |
| `VOICE_MODEL` | Defaults to `claude-haiku-5-5` |

Endpoints: `POST /turn` (the same agent over text, for the persona eval), `POST /twilio/inbound`, `/twilio/status`, `/twilio/amd`, and the `/media` WebSocket. `POST /turn` takes `{ sessionId, language, text, address?, requestStatus? }` and returns `{ reply, stage, record, done, escalations, nominations, guardBlocked }`. Send an empty `text` first to hear the opening.

**Who decides what.** Claude (`voice/agent/interpreter.ts`) turns one utterance into field changes, a yes/no answer, emergency flags and an acknowledgment of six words or fewer. The state machine (`voice/agent/conversation.ts`) decides what to ask next. Everything said about a ride is a fixed template keyed by request status (`voice/agent/script.ts`). A code guard (`voice/agent/honesty.ts`) replaces any acknowledgment that sounds like a promise while no driver has accepted.

### Voice exam

A practice exam for the agent, scored after the CritiCall 911-dispatcher test ([what it covers](https://www.youtube.com/watch?v=O8HKx8Rlug0)). Twenty scripted callers adapted from released wildfire 911 calls (Eaton, Camp, Carr, Lahaina, Marshall; sources in `voice/exam/sources.ts`) run against the real state machine, guard and Claude interpreter. Deterministic checks grade the record, escalations, read-back and status lines; Claude Opus 5.5 grades each whole call against the constitution (`CALL_TAKER_PRINCIPLES` in `voice/agent/interpreter.ts`).

```bash
npm run exam:voice                        # all items, about 4 minutes
npm run exam:voice -- --only honesty      # one module's items, or one item id
npm run exam:voice -- --no-judge          # fast loop; can't pass
npm run exam:voice -- --runs 3            # certify: every run of every item counts
```

Pass: every module at 90% or more (CritiCall agencies usually ask 70-75%) and zero critical errors. A critical error is a missed or late life threat, an implied promise or invented fact, a record that would leave someone behind, or silence taken as an answer. Results, transcripts and each failed check: `data/voice-exam-results.json`; each module names the file that owns it (`fixIn`).

Improvement loop: run the exam, take the most common failure, fix it in the module's `fixIn`, rerun that module with `--only`, then the whole exam and `npm run test:voice`. Stop at a pass with `--runs 3`. Never edit `voice/exam/` to make a call pass.

### Cartesia

Voice is the product: every rider call is heard by Ink and spoken by Sonic. Both run over WebSockets on Twilio's 8 kHz μ-law audio, so nothing is transcoded on the way in or out.

| Cartesia feature | What we use it for | Where |
| --- | --- | --- |
| Ink streaming speech-to-text (`ink-whisper`) | Hears the rider live in the call's language; restarts in a new language when the rider switches | `voice/phone/cartesia.ts` `Transcriber` |
| Ink end-of-speech (`max_silence_duration_secs` 0.5) | Ends the rider's turn; the call then waits 0.3 s after a full stop, 0.6 s with no punctuation, 1.3 s when the words trail off | `voice/phone/callSession.ts` `turnGap` |
| Sonic streaming text-to-speech (`sonic-latest`) | One request per agent turn, so intonation carries across its sentences | `voice/phone/speech.ts` |
| Sonic context cancel | Barge-in: when the rider talks over the agent, the rest of the turn is cancelled at once | `CallSpeech.bargeIn` |
| Sonic multilingual voices | Calls in en, es, zh, ko, vi, tl, ru and ja; `CARTESIA_VOICE_<CODE>` picks a native voice, otherwise the English voice speaks the language | `voice/env.ts` `voiceFor` |
| Short Sonic fillers ("Mm-hm.") | Cover Claude's thinking time without claiming to have understood anything | `backchannels` in `voice/agent/lines/*.ts` |

Measured: from the rider going quiet to the agent's first audio, the text eval puts the agent's own turn at 1.2 s median and 1.8 s p95 (`data/eval-results.json`); a live call adds Ink's 0.5 s end-of-speech wait and the turn gap above.

**Known limitations**

- Ink listens in one language at a time. A rider who switches languages is caught when they ask for it ("Korean, please") or when Claude recognizes the transcript; speech in a language the call isn't listening for can arrive garbled.
- Armenian and Persian are heard but Sonic can't speak them, so those callers are handed to a person (`language_barrier`).
- Six of the eight call languages (zh, ko, vi, tl, ru, ja) are machine translations awaiting a fluent speaker's review, and without `CARTESIA_VOICE_<CODE>` they are spoken by the English voice, with an English accent.
- Phone audio is 8 kHz, so voices sound like a phone call, not a studio recording.
- A status change (driver accepted, road closed) plays after the turn that's already speaking, a few seconds at most, not mid-sentence.
- As of Track B's last note, the Twilio account is a trial: every call opens with Twilio's notice, and outbound calls reach verified numbers only.

## Dispatch and simulator (Track C)

Turn off **Dispatcher and vehicle movement** on the call floor and the real dispatcher takes over. Every 5 s while riders wait, and at once when a road closes, `convex/dispatch.ts` forecasts each van's accepted run on the real road graph, revokes pickups a closure made unreachable in time, and asks the OR-Tools service for new offers. If the service doesn't answer, the heuristic in `convex/heuristic.ts` plans instead, and the plan records why.

| Where it runs | What |
| --- | --- |
| Convex | Re-planner, vehicle movement on road paths, closure snapping (`convex/dispatch*.ts`, `fleet.ts`, `roadGraph.ts`) |
| DigitalOcean App Platform | OR-Tools solver service, `dispatch/server.py` (`dispatch/deploy_digitalocean.sh` deploys it) |
| Vercel | The Next app, so the driver page opens on a phone |
| This repo | Road graph from OpenStreetMap via OSMnx (`data/roads/altadena.json`), simulator (`dispatch/sim/`) |

| Convex env variable | What it is |
| --- | --- |
| `SOLVER_URL` | The solver service's public URL. Unset means the heuristic plans |
| `SOLVER_TOKEN` | Bearer token the service requires, because problems carry riders' home coordinates |

```bash
cd dispatch
uv run pytest -q                                    # solver, heuristic parity, simulator
uv run python verify_dispatch.py --fallback-dir ..  # 10 end-to-end checks against the deployment in .env.local
uv run python -m sim.run --seeds 100                # writes data/sim-results.json
```

> Warning: `verify_dispatch.py` closes roads, cancels a driver and flips the dispatch switch on the deployment it targets. Pause the live dialer first. `npx convex run dispatchCheck:parkSimulatedRiders` and `dispatchCheck:reopenCheckClosures` clean up afterwards.

Simulated vehicles drive and board 4 times faster than real time (`SIMULATED_TIME_LAPSE` in `convex/vehicleRun.ts`). ETAs, deadlines and the solver stay in real minutes.

## Track D models

`modeling/` holds the hazard scenario, need model, door-check order, address matching, synthetic population, persona cards and the evaluations. `modeling/README.md` says how to run each one. During a session, run `cd modeling && uv run python scripts/run_models.py`.

## Stand-ins

`convex/sim.ts` and `convex/dispatchStandIn.ts` fake each backend track so the whole pipeline runs today. When your real service starts writing, flip its switch to **Real** in the call floor's Stand-ins panel. The stand-in then stops touching those records. `PLAN.md` lists every switch and its owner.

## Design norms

The call floor sets the look for every screen.

- **Look:** Red Cross-style white page, heavy condensed Archivo headings, square corners, one dark ink panel at the top.
- **Color:** tokens live in `app/globals.css`. Red (`--signal`) means "needs an accessible vehicle" and marks the brand, nothing else. Status colors: green leaving, orange needs a ride, red accessible, gray unreachable.
- **Type:** `type-display`, `type-title`, `type-heading`, `type-body`, `type-small`, `type-figure`. No all-caps labels and no letter-spacing.
- **Motion:** every animation shows a state change, such as a call starting, a field filling, or the queue reordering. All of it turns off under reduced motion.
- **Words:** never say "dashboard". Say "rescue map" or "call floor".
- **Code:** Phosphor icons only. One `Button` component. `npm run lint` enforces cyclomatic complexity 15.

Check work with `npm run typecheck && npm run lint`.

## Mesh add-on

Three features beside the core flow, with their own tables and pages; nothing in the core flow depends on them. `docs/mesh.md` has the design, the privacy accounting, the results and the limits.

- `/mesh`: a resident's phone. Road reports pass phone to phone with no internet: tabs on one device, or two phones paired by QR code over a shared Wi-Fi or hotspot.
- Federated learning over that mesh: noised updates are mixed between phones, and the agency only ever receives mixes of five or more phones. `/mesh/agency` shows what it received.
- `/flow`: Langevin dynamics for evacuating households on the real street graph, with the mesh on or off.
- A traffic forecast for the agency from the same dynamics: `npm run forecast:traffic` follows the incident with an ensemble of simulations and publishes the next hour's slow streets, with ranges, to `/mesh/agency`.

`npm run test:mesh` runs the add-on's tests. `npx tsx scripts/mesh/simulate.ts` regenerates `data/flow-results.json`.

## Readiness survey add-on

Decentralized data collection for disaster preparedness, before any disaster and separate from the evacuation night. Households answer sensitive questions on their own phones: whether their tap water is at risk, whether they could pay to evacuate, whether someone depends on powered medical equipment. Answers never leave the phone. `docs/prepare.md` has the design, the privacy accounting, the simulation results and the limits.

- `/prepare`: a household's phone. Answers stay on it. With consent, topic by topic, it adds randomized-response counts and noised federated-learning updates to one vector that it mixes with nearby phones (tabs on one device, or phones paired by QR code). Volunteer gateways upload only mixes of five or more households.
- `/prepare/county`: what the county learns. Shares by census block group with 95% intervals, and two shared models (unsafe tap water, can't afford to leave) that phones use to show each home its own risk.

`npm run test:prepare` runs the add-on's tests. `npx tsx scripts/prepare/simulate.ts --seeds 3` regenerates `data/prepare-results.json`; add `--publish` (with `--env-file=.env.local`) to send a simulated campaign through Convex so `/prepare/county` has data. `npx convex run prepare:clear` empties its tables.
