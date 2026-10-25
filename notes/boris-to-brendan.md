# Notes from Boris to Brendan

## 2026-10-24 20:40

About "63 of 65 in simulation versus 5 of 65 in real life": please don't pitch the 5 as real life. Both numbers come from the sampled simulator (`data/sim-results.json`). The 5 is our model of today's process, where 55% call 911 about 20 minutes before the fire and the nearest unit takes one rider per trip. The sample is also generous to us: 600 homes and 8 vans, with every home at least 45 minutes from the made-up fire.

The bedbound split is in (`requests.party`; see `notes/boris-to-everyone.md`). The sampled simulator now gets 64 of 65 out.

For the pitch, use the full-scale run on the real night (`data/eaton/night-sim-results.json`, README "Replaying the night in west Altadena"):

- **The setup:** all 11,855 synthetic households, with no sampling. The fire is timed from the FSRI 911 and radio sightings and placed by CAL FIRE's damage inspections. Of the 1,262 homes that need a ride, the fire reached 662 that the record puts a time on.
- **Calls at 10:50 p.m. (the first fire west of Lake), 25 vans:** our system gets 641 of 662 out on time. Our model of today's process gets 39.
- **Calls at the real 3:25 a.m. order, vans from 4 a.m., 50 vans:** 356 of 662. Fire was already reported near 220 of those homes before 3:25, so 442 was the most any fleet could get out.
- **The line that holds up:** "Twenty-five vans, under 2% of AccessLA's fleet, would have been enough, if the calls had started when the fire crossed Lake Avenue."
- **The documented records:** 16 households west of Lake asked for help because someone couldn't get out alone. The records show 1 of them getting out. That's the only true real-life number, and it isn't out of 65.

## 2026-10-24 22:30

The quote on the proof slide wasn't what was said, so I changed it to the words on the Station 1 recording (at 12:39): "Honestly, this one is probably the most at the cutting edge of what we're already doing and what could be helpful." The slide had "Is the most cutting-edge EMT improvement idea I've heard". Judges may ask about it, and the README already quotes the recording. The recording doesn't say he's an EMT, so the label now reads "Firefighter, Palo Alto Fire Station 1". The new quote is longer, so please check that the slide still fits at your screen size. I didn't open it in a browser.

## 2026-10-25 00:05

The proof slide now uses the 10:50 p.m. row on both sides, so only the process differs: same night, same 25 vans. Today's process gets 39 of 662 out (6%), and Standard Response gets 641 (97%). `components/present/cues.json` lines 8.2 and 8.3 now say "only 6%" and "With Standard Response and the same 25 vans, 97% did." Please match your script doc.

The deck's photos, the Roseland call recording and the brand fonts are gitignored, so they exist only on your laptop. Anyone else running `/present` gets missing images and fallback fonts. If someone else might present, please send them the `public/present/` and `public/brand-fonts/` folders.
