# Rollcall (working name)

Evacuation calling and dispatch for Cal Hacks 13.0. This repo is **Part 0**: the shared data contract, stand-ins for every service, and the call floor where we watch and steer the calling agents.

> Warning: everything the stand-ins produce is simulated. Never show a stand-in number to judges as a real result.

## Run it

```bash
npm install
npm run dev:backend   # Convex. First run asks to log in or use a local anonymous backend
npm run dev           # http://localhost:3000
```

Open the page and press **Issue evacuation warning**. That seeds 200 simulated households in west Altadena and starts the stand-in dialer, voice agent and need model.

**Shared backend.** A local anonymous backend lives on your laptop only. For integration, one person runs `npx convex login` then `npx convex dev` to create a cloud dev deployment and invites the team; everyone else runs `npx convex dev` against that project.

## How the pieces connect

```
 voice server (Jerry) ──calls:*, households:update──►┐
 need + fire model (David) ──households:setEstimates─►│   Convex tables    ├──► call floor (this app)
 optimizer (Boris) ◄──households:needingRides─────────┤  (convex/schema.ts) ├──► rescue map (Brendan)
 optimizer (Boris) ──vehicles, assignments───────────►┘
```

Every service talks only to Convex. Nobody calls anybody else directly, so nobody waits on anybody.

## Who writes what

| Table | Written by | Read by |
| --- | --- | --- |
| `households` record fields (`canLeave`, `mobility`, ...) | Voice (Jerry) | Optimizer, map, call floor |
| `households.needProbability`, `fireArrivalAt`, `callPriority` | Models (David) | Dialer, map |
| `calls`, `transcriptLines` | Voice (Jerry) | Call floor |
| `vehicles`, `assignments` | Optimizer (Boris) | Map, voice callback |
| `personas` | Seed only | Stand-in voice agent and call-accuracy eval. Real agents must never read it |
| `control` | Call floor | Stand-in loop |
| `events` | Anyone | Call floor activity feed |

Change a field in `convex/schema.ts` only after telling the people in its row.

## Calling Convex from Python

```bash
pip install convex
```

```python
from convex import ConvexClient
client = ConvexClient(os.environ["CONVEX_URL"])  # NEXT_PUBLIC_CONVEX_URL from .env.local

# Voice (Jerry)
call_id = client.mutation("calls:start", {"householdId": hid, "direction": "outbound"})
client.mutation("calls:setStage", {"callId": call_id, "stage": "can_leave"})
client.mutation("calls:say", {"callId": call_id, "speaker": "resident", "text": "No, I can't get out."})
client.mutation("households:update", {"householdId": hid, "patch": {"canLeave": "no"}, "confidence": {"canLeave": 0.92}})
client.mutation("calls:end", {"callId": call_id, "answered": True})   # False runs retry, then text
client.mutation("calls:resolveFollowUp", {"householdId": hid, "result": "door_check"})

# Models (David)
client.mutation("households:setEstimates", {"estimates": [{"householdId": hid, "needProbability": 0.61, "fireArrivalAt": eta_ms}]})
next_up = client.query("households:queue", {"limit": 20})

# Optimizer (Boris)
for requests in client.subscribe("households:needingRides", {}):  # re-plan on every change
    ...
```

## Stand-ins

`convex/sim.ts` fakes each teammate's service so the whole pipeline runs today. When your real service starts writing, flip its switch to **Real** in the call floor's Stand-ins panel. The stand-in then stops touching those records.

| Stand-in | Fakes | Replace by |
| --- | --- | --- |
| Voice agent and dialer | Rings, scripted conversations in English, Spanish and Chinese, retries, text replies | Twilio + Claude + Cartesia writing the same `calls:*` mutations |
| Need model | Census prior shrunk toward nearby answered calls | Your spatial model writing `households:setEstimates` |

Dispatch has no stand-in yet. `vehicles` and `assignments` are in the schema and empty.

## Parallel plan from here

Each track builds against the stand-ins and the contract above, so all four start now.

| Owner | First build | Test it against | Done when |
| --- | --- | --- | --- |
| Jerry, voice | Twilio Media Streams server, Claude tool `update_household`, the seven-step state machine (`callStage` in the schema) | Flip Voice to Real; your calls show up as live lines with a transcript | A phone call fills a household record on the call floor |
| David, models | Fire arrival per address, census prior, live posterior, written with `setEstimates` | Flip Need model to Real; watch "Next to call" reorder | Answered wheelchair calls push neighbors up the queue |
| Boris, optimizer | OSMnx road graph, OR-Tools dial-a-ride over `needingRides`, writing `vehicles` and `assignments` | Stand-in voice produces ride requests within a minute of the warning | Assignments appear for every ride request |
| Brendan, map | Rescue map at `app/map/page.tsx`, reusing `components/ui` and the tokens in `app/globals.css` | `households:coverage` and stand-in data | Commander approves a plan with one click |

Integration points to agree on tonight:

- **Inbound callers we have never seen.** Jerry adds a `households:findOrCreateByPhone` mutation. Decide whether `lat` and `lng` stay required before geocoding.
- **Approval to callback.** The map flips `assignments.approved`; the voice server subscribes, places the callback, then sets `calledBack`.
- **Time.** All timestamps are epoch milliseconds. Fire replay mode should shift `fireArrivalAt`, not the clock.

## Design norms

The call floor sets the look for every screen.

- **Look:** Red Cross-style white page, heavy condensed Archivo headings, square corners, one dark ink panel at the top.
- **Color:** tokens live in `app/globals.css`. Red (`--signal`) means "needs an accessible vehicle" and marks the brand, nothing else. Status colors: green leaving, orange needs a ride, red accessible, gray unreachable.
- **Type:** `type-display`, `type-title`, `type-heading`, `type-body`, `type-small`, `type-figure`. No all-caps labels and no letter-spacing.
- **Motion:** every animation shows a state change, such as a call starting, a field filling, or the queue reordering. All of it turns off under reduced motion.
- **Words:** never say "dashboard". Say "rescue map" or "call floor".
- **Code:** Phosphor icons only. One `Button` component. `npm run lint` enforces cyclomatic complexity 15.

Check work with `npm run typecheck && npm run lint`.
