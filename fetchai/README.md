# Fetch.ai agent: a second front door to the Ready check

A uAgent that speaks the Fetch.ai Chat Protocol, so people and other AI agents on ASI:One can reach it. It does two things:

1. Signs a household up for the Ready check from free text ("my mom at 486 W Mariposa St, Altadena uses a walker, her number is 626-555-0101, she needs a ride"). It reads the text with Claude, repeats what it understood, and calls Convex only after the person says yes.
2. Says whether an evacuation warning is active, for an address or in general, with the fixed advice "if you can leave safely, leave now" and the evacuation line number.

It never returns anyone's record. Convex answers the sign-up with the address the caller just sent, and the status route returns only the fields `warningActive`, `coversPlace`, `guidance` and `evacuationLine`. A phone number that is already on file is skipped and gets the same answer as a new one, so the route cannot overwrite a profile or reveal who is signed up. Sign-ups stay unverified until the evacuation line calls to confirm.

```
ASI:One user or agent -> Agentverse mailbox -> this agent -> Claude (claude-haiku-5-5, tool use)
                                                         -> Nominatim (address to lat/lng)
                                                         -> Convex POST /agent/ready-signup, /agent/status
```

Addresses are turned into coordinates here with OpenStreetMap Nominatim (free, sent with an identifying User-Agent). The repo's own geocoder (`modeling/rollcall_d/eaton.py`) is an offline Python tool and cannot run inside Convex.

## Setup

Convex (the `.convex.site` deployment):

```bash
npx convex env set FETCH_AGENT_SECRET "$(openssl rand -hex 32)"
npx convex env set EVACUATION_LINE_NUMBER "+1..."   # optional, shown in status answers
```

The agent, in `fetchai/`:

```bash
uv sync
export AGENT_SEED_PHRASE="a long private phrase"   # fixes the agent address
export ANTHROPIC_API_KEY=...
export FETCH_AGENT_SECRET=...                       # same value as in Convex
export CONVEX_SITE_URL=https://<deployment>.convex.site
export AGENTVERSE_API_KEY=...                       # from agentverse.ai, only needed for the programmatic registration route
uv run python -m rollcall_agent.agent
```

Tests: `uv run pytest -q` (fake Claude, mocked HTTP; no network). Convex side: `npx vitest run tests/workflow/fetchAgent.test.ts --environment edge-runtime`.

## Connect it to Agentverse and ASI:One

1. Run the agent. The log prints an Agent Inspector URL.
2. Open it, click Connect, choose Mailbox, then Finish.
3. On agentverse.ai, open the agent under Local Agents, fill in its README and description (use the first section above), and keep the process running.
4. In ASI:One, turn on the Agents option and ask for the agent by name or by what it does.

The agent publishes the Chat Protocol manifest on start (`publish_manifest=True`), which is what makes it callable from ASI:One.
