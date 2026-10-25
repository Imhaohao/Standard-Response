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
