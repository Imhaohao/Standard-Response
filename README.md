# Standard Response

Standard Response gets people who can't evacuate on their own into a vehicle that can actually carry them. When an evacuation warning goes out, our voice agent calls every home in the zone to find out who can't leave and what help they need. Each answer becomes a ride request on a live map. A routing optimizer matches every request to a van with the right space and crew. Nobody is told help is coming until a driver has accepted the pickup on their own phone.

It works for any disaster that forces people out of their homes, including wildfires, floods, earthquakes, landslides and hurricanes. Each hazard changes what the agent tells people to do and how fast the deadline moves. The calls, the ride requests and the dispatch work the same way for all of them. Our demo replays a wildfire on a real map of Altadena, California.

## Why we built it

In January 2025 the Eaton Fire reached west Altadena overnight. A father who used a wheelchair lived there with his son, who has cerebral palsy. The evacuation order for their part of town came at 3:25am, with no warning before it. The county's paratransit service said its vans were ready by 4am, but nobody called it. The father called 911 at 6:03 and again at 6:14. The dispatcher told him "we have a lot of calls in that area." Both men were found dead around 8:30am.

Vans existed that night. Nothing connected them to the people who couldn't get out. We found the same gap in every large disaster we looked at:

| Disaster | Deaths | Who died |
| --- | --- | --- |
| LA County fires (2025) | 30 | Mostly older, many disabled. The 17 Eaton victims counted early on averaged 77 years old |
| Lahaina, Maui (2023) | 102 | More than two-thirds were in their 60s or older |
| Camp Fire, Paradise (2018) | 85 | A majority were over 65 |
| Hurricane Katrina, Louisiana (2005) | 971 | Almost half were 75 or older |

A UN survey of about 6,000 people with disabilities found that only 1 in 5 could evacuate right away without difficulty. Disability registries were supposed to close this gap. During Hurricane Harvey, fewer than 5% of the people on Texas's registry were contacted, because nobody had the staff to call through the list in time. An AI voice agent removes that limit. It can hold thousands of calls at once, in the caller's own language.

## What it does

**Before any disaster, the Ready check.** The agent calls each household in an agency's area, or the household signs up at `/ready` on its own phone. It records who lives there, what help they'd need getting out, and where that person sleeps. A household can also name a helper, such as a relative or neighbor, who has agreed to pick them up.

**When a warning goes out:**

1. A dispatcher draws the warning zone on the rescue map. Our Apify Actor can also start this automatically when a California county moves a zone to warning.
2. The agent calls every home inside the zone. It confirms where the person is and whether everyone can leave. Then it asks how many people are there and what help they need. Before hanging up, it reads the answers back so the resident can correct them.
3. If a home has a helper on file, the agent calls the helper first. A helper who says no or doesn't answer turns the home into a ride request at once, with its needs already filled in.
4. The optimizer, built on Google OR-Tools, assigns each request to a vehicle with enough seats, wheelchair spaces and crew to do the pickup. A dispatcher approves the plan. Each driver then accepts or declines on their phone.
5. Once a driver accepts, the resident gets a call back with the driver's name, the vehicle and the ETA. If a road closes and the driver can no longer reach them, the resident hears that right away.
6. Silence never counts as safe. An unanswered home is called again at 2 and 5 minutes, then texted. If nobody replies, it goes on the list of doors for field crews to knock on.

**The honesty rule.** The agent can't say help is coming unless a driver has accepted. Code enforces this, not the prompt. Every sentence about a ride is a fixed template picked by the request's status. Claude only reads what the resident said and writes a short acknowledgment. A code guard blocks that acknowledgment if it sounds like a promise. A separate Claude grader checked 2,046 of the agent's own lines from test calls against this rule and flagged 9 of them (`data/honesty-results.json`).

| Screen | Path | Who it's for |
| --- | --- | --- |
| Rescue map | `/map` | Dispatchers. Every home, ride request, neighbor pickup and van on one map, with the hazard spreading across it |
| Call floor | `/` | Dispatchers. Every live call, what the agent heard, and the queue |
| Driver page | `/driver` | Drivers. Ride offers to accept, and the run once accepted |
| Simulated phone | `/phone` | Demos. A resident's side of the call and texts, without dialing a real number |
| Under the hood | `/system` | Judges. How dispatch decides, with the numbers behind it |
| Ready sign-up | `/ready` | Residents. The Ready check profile, filled in on their own phone |

## Replaying the night in west Altadena

We rebuilt the night of January 7 to 8, 2025 from public records and ran our system's rules against it. The UL Fire Safety Research Institute published more than 3,300 timestamped Eaton Fire records, taken from dispatch logs, radio and body-camera transcripts, and the alert archive. LA County's own investigation gives the time of every evacuation order. We placed each record on the map by its block and read every request for help west of Lake Avenue by hand.

Sixteen households west of Lake asked for help because someone there couldn't get out alone. Three of them asked before midnight, more than three hours before the 3:25 a.m. order. For one of the sixteen the records show the resident got out. Two were still asking for help after 6:30 a.m. with fire in the yard.

| If our system had run that night | Reached before they had to ask for help | Reached before fire was reported within two blocks |
| --- | --- | --- |
| Calls start with the real 3:25 a.m. order, and AccessLA's vans leave at 4 a.m. | 11 of 16 | 8 of 14 |
| Calls and AccessLA start at 10:50 p.m., when the first fire west of Lake was reported | 13 of 16 | 14 of 14 |

Two of the sixteen had no fire reported within two blocks, so the last column counts fourteen. The three still missed in the second row asked for help in the evening, at 8:28, 9:31 and 11:20 p.m. A van would have boarded each of them within 25 minutes of their call.

That replay assumes a van drives at free-flow speed from the Rose Bowl command post. It takes 4 minutes to reach the household by phone and 3 more for a driver to accept, then the boarding times in `PLAN.md`.

Those sixteen are only the people whose calls got through. To see the whole west side, we ran our dispatch simulator on the night itself. All 11,855 households in our synthetic census population are in it, with none sampled. Of the 1,262 that need a ride, the fire reached 662 that the record puts a time on. CAL FIRE's damage inspections say which homes the fire reached. The first fire sighting within 250 meters in the FSRI records says when. The simulator calls every home at one call a second, then retries, texts and sends door teams, while the dispatcher routes the vans from the Rose Bowl.

| Calls start | Vans | Out on time with our system | Out on time with today's process |
| --- | --- | --- | --- |
| 10:50 p.m., first fire west of Lake | 8 | 195 of 662 | 16 of 662 |
| 10:50 p.m. | 25 | 641 of 662 | 39 of 662 |
| 10:50 p.m. | 50 | 642 of 662 | 68 of 662 |
| 3:25 a.m., the real order (vans from 4 a.m.) | 25 | 228 of 662 | 29 of 662 |
| 3:25 a.m. | 50 | 356 of 662 | 43 of 662 |
| 3:25 a.m. | 100 | 360 of 662 | 48 of 662 |

"On time" means everyone in the household was aboard at least 10 minutes before fire was reported near the home. Each figure is the median of five runs. When calls start at 3:25 a.m., fire had already been reported near 220 of the 662 homes, so no fleet could get more than 442 out. Fifty vans get 356 of those 442. Twenty-five vans is under 2% of AccessLA's fleet of more than 1,800, which LAist reported was ready by 4 a.m. and never called.

The right-hand column is our model of today's process, not the record. In it, 55% of the people who need a ride call 911 about 20 minutes before the fire reaches them, and the nearest free unit takes one household per trip. On the real night AccessLA wasn't called at all.

The simulation is a test of timing, not a claim about who would have lived. Several of its assumptions flatter both columns:
- **Late deadlines.** A first sighting comes after the fire arrives, so every deadline is a little late.
- **No traffic.** Driving is at free-flow speed on every street the fire hasn't reached.
- **Perfect calls.** Everyone who answers reports their needs correctly.
- **A known fire.** Our calls go out in the order the fire actually arrived. Calling by need alone lowered one run from 641 to 633, and another from 356 to 337.

It can't know whether someone would have answered or been ready at the door. Every assumption is listed in `data/eaton/night-sim-results.json`, and the sixteen documented requests, with their source rows, are in `data/eaton/replay-results.json`.

```bash
cd modeling
uv run python scripts/fetch_eaton.py    # the FSRI timeline sheet
uv run python scripts/fetch_dins.py     # CAL FIRE's damage inspections, data/eaton/dins-eaton.json
uv run python scripts/eaton_replay.py   # the sixteen requests, data/eaton/replay-results.json
cd ../dispatch
uv run python -m sim.eaton_night --seeds 5   # the whole night, data/eaton/night-sim-results.json
```

## What firefighters changed

On October 24 we visited two Palo Alto fire stations, University Park (Station 1) and Station 6, which covers Stanford. We spoke with about six firefighters, including a station captain. Both stations backed the triage. At Station 1 one of them said: "Honestly, this one is probably the most at the cutting edge of what we're already doing and what could be helpful." They also pointed out four gaps. We fixed all four that afternoon.

| What they told us | What we changed |
| --- | --- |
| "Oh, you said wheelchair, I thought wheelchair. And then you get there, and it's a battery-operated wheelchair, and they're 400 pounds." | When someone says "wheelchair" without saying which kind, the agent now asks whether it has a motor. It asks on the night and on the Ready check call. 911 never asks a neighbor to pick up someone in a power chair in their own car. The sign-up form and the house card now say "Manual chair" instead of just "Wheelchair". |
| A neighbor who offers to help needs to know "what they're getting into right away." | Before asking a helper whether they can come, the agent tells them what the pickup takes: "They use a walker. They need one person to help them to the car." |
| On the call they'd just come back from, nobody at the home spoke English. The crew had to track down a relative to translate. | The house card, which a crew reads before going in, now shows the language the household speaks. |
| Asking neighbors on the night risks "sending more people into a danger zone," or a helper "going backwards into a one-way street." | 911 now asks only neighbors whose home the hazard reaches no later than the resident's. Driving over to help them means driving away from the danger. |

They also confirmed a choice we'd already made. Station 1 said the most useful thing would be "pre-gathered information about what's going on at an individual residence," down to which rooms people sleep in. The Ready check collects exactly that.

## How we use our sponsors

| Sponsor | What it does for us | Where |
| --- | --- | --- |
| Anthropic | Claude reads each thing a resident says on a call. It turns messy, corrected speech in eight languages into record fields, a yes or no, and any emergency. Claude Opus 5.5 in fast mode runs live calls. A second Claude model grades whole practice calls in our voice exam and checks the agent's lines for implied promises. | `voice/agent/interpreter.ts`, `voice/exam/judge.ts` |
| Cartesia | Ink transcribes the caller as they speak, and Sonic speaks the agent's lines. Both stream over WebSockets on the phone call's own audio. The full feature list and limits are below. | `voice/phone/` |
| Moss | Before Claude reads each turn, the agent searches two Moss indexes in memory within an 80 ms budget. One holds our call-taking principles and the other holds moments from past 911 calls with their correct readings. The closest matches go into that turn's prompt. When a caller asks a policy question ("Can my dog come?", "¿Cuánto cuesta?"), Claude restates it in English and a third index matches it to the agency's approved answer in 1 to 2 ms. The caller hears that answer word for word in their language, and below a 0.7 match score the agent says it doesn't know. | `voice/knowledge/moss.ts`, `voice/agent/answerLookup.ts` |
| Convex | Every part of the system reads and writes one real-time Convex database. No service calls another directly. Mutations enforce the rules a promise depends on: version-checked offer acceptance, idempotent callbacks and revocation. Each real rider's retry schedule runs as a durable Convex Workflow, and the household counts come from the Aggregate component. | `convex/` |
| Apify | Our public "California evacuation status" Actor normalizes county and state evacuation zones and Caltrans road closures. When a zone with riders on it goes to warning, the Actor calls our Convex endpoint to start the calls. When Caltrans fully closes one of our streets, the Actor posts it to a second endpoint, and the next plan routes vans around it. When Caltrans lifts the closure, the road reopens. | `apify/california-evacuation-status/`, `convex/http.ts`, `convex/apify.ts` |
| Auth0 | Auth0 handles dispatcher login. Only dispatchers and drivers can see the at-risk list, and the first ride approval of a session asks for a second factor. | `proxy.ts`, `lib/access.ts` |
| DigitalOcean | App Platform hosts the OR-Tools solver service. | `dispatch/server.py` |
| Vercel | Vercel hosts the web app. Drivers open the driver page on their own phones. | |

Twilio carries the phone calls. The voice server runs on Fly.io.

### Cartesia

Every rider call is heard by Ink and spoken by Sonic. Because both run over WebSockets on Twilio's own 8 kHz μ-law audio, nothing is transcoded on the way in or out.

| Cartesia feature | What we use it for | Where |
| --- | --- | --- |
| Ink streaming speech-to-text (`ink-2`, `ink-whisper`) | Hears the rider live. English, Spanish and Japanese use Ink-2, which decides when the rider has finished; other languages use `ink-whisper`. It restarts in a new language when the rider switches | `voice/phone/cartesia.ts` `Transcriber` |
| Ink end-of-speech (`max_silence_duration_secs` 0.5) | Ends the rider's turn. The call then waits 0.3 s after a full stop, 0.6 s with no punctuation, and 1.3 s when the words trail off | `voice/phone/callSession.ts` `turnGap` |
| Sonic streaming text-to-speech (`sonic-latest`) | Each agent turn is one request. That way intonation carries across its sentences | `voice/phone/speech.ts` |
| Sonic context cancel | Barge-in: when the rider talks over the agent, the rest of the turn is cancelled at once | `CallSpeech.bargeIn` |
| Sonic multilingual voices | Calls in en, es, zh, ko, vi, tl, ru and ja. `CARTESIA_VOICE_<CODE>` picks a native voice; otherwise the English voice speaks the language | `voice/env.ts` `voiceFor` |
| Short Sonic fillers ("Mm-hm.") | Cover Claude's thinking time without claiming to have understood anything | `backchannels` in `voice/agent/lines/*.ts` |

In the latest voice exam, the agent's own turn took 0.92 s at the median and 1.62 s at the 95th percentile (`data/voice-exam-results.json`). A live call adds Ink's 0.5 s end-of-speech wait and the turn gap above.

**Known limitations**

- Ink listens in one language at a time. We catch a rider who switches languages when they ask for it ("Korean, please") or when Claude recognizes the transcript. Speech in a language the call isn't listening for can arrive garbled.
- Ink hears Armenian and Persian, but Sonic can't speak them. Those callers are handed to a person.
- Six of the eight call languages (zh, ko, vi, tl, ru and ja) are machine translations waiting for review by a fluent speaker. Without `CARTESIA_VOICE_<CODE>`, the English voice speaks them with an English accent.
- Because phone audio is 8 kHz, voices sound like a phone call rather than a studio recording.
- A status change, such as a driver accepting or a road closing, plays after the turn that's already speaking. That's a few seconds at most, but it never cuts in mid-sentence.
- The Twilio account is a trial as of Brendan's last note. Every call opens with Twilio's notice. Outbound calls reach verified numbers only.
