# Rollcall (working name)

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
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Telephony |
| `VOICE_PUBLIC_URL` | Public https URL of this server; Twilio calls back here |
| `DIAL_ALLOWLIST` | Comma-separated numbers the dialer may ring. Every other number is skipped, so a fictional rider list never rings a stranger |
| `VOICE_MODEL` | Defaults to `claude-haiku-5-5` |

Endpoints: `POST /turn` (the same agent over text, for the persona eval), `POST /twilio/inbound`, `/twilio/status`, `/twilio/amd`, and the `/media` WebSocket. `POST /turn` takes `{ sessionId, language, text, address?, requestStatus? }` and returns `{ reply, stage, record, done, escalations, nominations, guardBlocked }`. Send an empty `text` first to hear the opening.

**Who decides what.** Claude (`voice/agent/interpreter.ts`) turns one utterance into field changes, a yes/no answer, emergency flags and an acknowledgment of six words or fewer. The state machine (`voice/agent/conversation.ts`) decides what to ask next. Everything said about a ride is a fixed template keyed by request status (`voice/agent/script.ts`). A code guard (`voice/agent/honesty.ts`) replaces any acknowledgment that sounds like a promise while no driver has accepted.

**Cartesia.** Ink speech-to-text (`ink-whisper`, English and Spanish) and Sonic text-to-speech, both on 8 kHz μ-law, so Twilio audio passes through without transcoding. Each sentence is its own text-to-speech context: a barge-in cancels the rest, and a status change cuts in at the next sentence boundary.

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
