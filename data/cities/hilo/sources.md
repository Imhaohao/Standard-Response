# Hilo: the tsunami of 23 May 1960

All times are Hawaii Standard Time. In 1960 that was UTC-10:00: Hawaii moved from -10:30 to -10:00 on 8 June 1947 (IANA tz `Pacific/Honolulu`). Elevations are metres above local mean sea level, which is the datum of the 3DEP DEM in Hawaii.

Built by `modeling/scripts/cities/build_water_scenario.py --city hilo` into `public/scenarios/hilo.json`. The inputs are in this folder: `timeline.json`, `series.json`, `runup-loomis-1976.json` and `evacuation-zones.geojson`. `water_fetch_inputs.py --city hilo` downloads the last two.

## Sources and what we took

**Eaton, Richter & Ault (1961), "The tsunami of May 23, 1960, on the island of Hawaii", BSSA 51(2):135–157.** https://doi.org/10.1785/BSSA0510020135. The paper is paywalled. We use its abstract, and its p. 139 narrative as quoted with page numbers in Johnston (2003). It gives the measurements at the Wailuku River bridge, each relative to normal water:

| Time | Water at the bridge |
|---|---|
| 00:07 | rise begins |
| 00:13 | wave 1 crest, +4 ft |
| 00:30 | trough, -3 ft |
| 00:46 | wave 2 crest, +9 ft; it flooded Kamehameha Ave |
| 01:00 | trough, -7 ft |
| 01:04 | wave 3 arrives as a bore about 20 ft high |

The abstract adds that the bore rose 35 ft above sea level.

**Johnston (2003), MA thesis, University of Hawaii.** https://scholarspace.manoa.hawaii.edu/server/api/core/bitstreams/8f4f80b7-7013-4310-a60e-020dfecacb65/content. It transcribes the 1960 Civil Defense, Police and Fire logs:
- Sirens were held at 20:00 and authorised at 20:15.
- The first siren sounded at **20:35, minute 0**, followed by more at 20:40, 20:43, 20:47 and 20:50.
- Police were told to evacuate low areas at 21:56.
- The tide-gauge alarm went off at 00:09.
- Water was over the pier at 00:47.
- Kamehameha Ave was covered about 00:55–00:58.
- The lights went out at 01:05.

**Atwater et al., USGS Circular 1187, pp. 6–7.** https://pubs.usgs.gov/circ/c1187/
- The warning was issued at 18:47, and the waves were expected at about midnight.
- The sirens sounded "around 8:30 p.m."
- Only about a third of people took the siren as a signal to leave.
- The Waiakea clock stopped at 01:04.
- There were 61 deaths and 282 serious injuries.

**Lander & Lockridge (1989), NGDC Pub. 41-2, pp. 46–47 and 62.** https://www.ngdc.noaa.gov/hazard/data/publications/pub41-2.pdf
- 600 acres (about 2.43 km²) were inundated, and all 61 deaths were inside them.
- Hilo's runup was 10.7 m, with a period of 30 minutes.

**Loomis (1976), *Tsunami Wave Runup Heights in Hawaii*,** as the Hawaii Statewide GIS layer https://geodata.hawaii.gov/arcgis/rest/services/Hazards/MapServer/1. It gives 1960 runup heights in feet at 18 numbered points around Hilo Bay, from 10 to 35 ft. These shape the bore's inundation.

**NOAA NCEI tsunami runup 3922.** https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/runups/3922
- Height 10.7 m and period 30 minutes.
- Arrival 09:58 UTC, which is 23:58 HST. That conflicts with Eaton's 00:07. We use Eaton, the measurement made at Hilo.

**Scripps Institution of Oceanography press release, 28 Oct 1960.** https://library.ucsd.edu/dc/object/bb3038840p/_2.pdf. It estimates the bore at about 20 mph (536 m a minute), with 2–3 minutes for people on shore to escape.

**USGS ComCat.** The earthquake was at 19:11:20 UTC on 22 May (09:11 HST), Mw 9.5, at 38.143 S, 73.407 W.

**NOAA CO-OPS Hilo 1617760.**
- Datums for the 1983–2001 epoch put MSL 0.349 m above MLLW.
- The tide prediction for that night gives a high of 1.59 ft MLLW at 01:23.

**Hawaii County tsunami evacuation zones (March 2025, corrected Nov 2025).** https://geodata.hawaii.gov/arcgis/rest/services/Hazards/MapServer/2 (extreme zone: layer 12). Clipped into `evacuation-zones.geojson`. We use them only as a check (see below), not to shape the fronts.

**USGS 3DEP 1/3 arc-second DEM**, resampled to 5 m.

## How the fronts are made

1. Waves 1 and 2 flood every cell that is joined to Hilo Bay and lies below the wave's height above normal water, plus the tide.
2. The rise from each published trough (or start of rise) to its crest is assumed linear.
3. The bore floods every joined cell below the local 1960 runup height. That height is interpolated between Loomis's points by inverse distance.
4. The bore runs inland from the bay at 536 m a minute.

**Check:** the final front covers 2.47 km². Lander & Lockridge report about 2.43 km² (600 acres). Only 0.08 km² of the flooded area lies outside today's county evacuation zone.

## Assumptions

- **Normal water was the tide, about +0.1 m MSL** *(assumption)*. This is derived from NOAA's harmonic prediction, not a 1960 observation. The Hilo gauge was damaged during the event.
- **Loomis's heights are above MLLW** *(assumption)*. NCEI's matching survey entries say "relative to mean lower low water". We subtract 0.349 m to get MSL.
- **Rising limbs are linear** *(derived)*. They connect Eaton's published trough and crest times. Nothing was measured between them.
- **Bore speed** *(assumption)*. It comes from the Scripps estimate. Distance is a straight line from the open bay.
- **The bay faces north-east** *(assumption)*. `approachFromDegrees` (45°) is the direction Hilo Bay opens to, read from the map. No published wave direction is used.
- **Wave periods** *(source / derived)*. Wave 1's 30 minutes is published. The 33 and 18 minutes for waves 2 and 3 are the intervals between crests.
- **`runupMeters`** *(source)*. For waves 1 and 2 it is the measured water level at the bridge plus the tide, because no runup was published for them. For wave 3 it is the published 10.7 m maximum runup.
- **Today's ground** *(assumption)*. The DEM is today's ground. After 1960, Waiakea and Shinmachi became Wailoa River State Park, and parts of the bayfront were filled.
- **Later waves left out** *(assumption)*. Eaton's figure shows more crests until about 02:00. They are left out because none reached as far as the bore.

## Deadline for the dispatch simulator

- **On time means aboard and above the evacuation line before the first wave begins: 00:07 on 23 May, minute 212.** This applies to everyone in the county's tsunami evacuation zone, not only those inside the fronts.
- The reason is that nobody on shore could know which wave would be the big one. The first two waves seemed small: "only 7 feet high". People who stayed, or came back to watch, died when the third wave arrived as a bore at 01:04.
- **Hard limit: the front that first contains the home.** A deadline set at the water's arrival would repeat 1960's mistake.
