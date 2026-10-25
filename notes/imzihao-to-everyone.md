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
