# Fort Myers Beach: Hurricane Ian storm surge, 28 September 2022

All times are Eastern Daylight Time (UTC-4). Elevations are metres NAVD88. Built by `modeling/scripts/cities/water_fetch_inputs.py --city fort-myers-beach` (downloads) and `build_water_scenario.py --city fort-myers-beach` into `public/scenarios/fort-myers-beach.json`, from `timeline.json` and `gauges.json` in this folder.

## Sources and what we took

**NHC Tropical Cyclone Report AL092022** (Bucci, Alaka, Hagen, Delgado & Beven; revised 12 March 2026). https://www.nhc.noaa.gov/data/tcr/AL092022_Ian.pdf
- Landfall on Cayo Costa at 15:05 (1905 UTC) at 130 kt and 941 mb.
- Peak inundation on Fort Myers Beach was 10–15 ft above ground.
- Table 3 lists the pier sensor at 13.23 ft NAVD88, which is 12.70 ft above MHHW.
- The NWS found marks of about 15 ft above MHHW.
- Fig. 11 gives the times from the Estero Blvd camera, which sat under 0.5 mi from the pier:
  - 10:38: onset of street flooding
  - 13:39: debris-laden current
  - 14:19: a house floats away
  - 17:03: the water recedes
- The Storm Surge Warning was issued at 2100 UTC on 26 Sep.
- 36 of the 41 US surge deaths were in Lee County.
- The TCR has no reliable wind observations from the landfall coast: "Because of instrument failure, no reliable surface observations exist…".

**USGS Short-Term Network, event 325 (2022 Ian).** https://api.waterdata.usgs.gov/stnservices/ (the old stn.wim.usgs.gov host now redirects)
- FLLEE03382 is on the Fort Myers Beach pier at 26.45239, -81.95666. Its wave-filtered water level (file 130763, 6-minute Butterworth low-pass) is the scenario's water level. It peaked at 4.033 m (13.23 ft) at 14:39.
- FLLEE03284 is at Matanzas Pass, on the San Carlos Island side (file 130798). It peaked at 3.675 m at 15:06.
- FLLEE03288 is at the Big Carlos Pass bridge (file 130439). It peaked at 3.506 m at 15:34; the USGS peak summary says 15:50.
- FLLEE03246 is at the Punta Rassa boat ramp on San Carlos Bay (26.4843, -82.0106; file 131871), just north-west of the map. It peaked at 2.691 m at 15:36.
- FLLEE03287 is at Mullock Creek marina on Estero Bay's mainland shore (26.4733, -81.8517; file 131494), just east of the map. It peaked at 3.156 m at 16:51.
- These five are the storm-tide sensors in STN event 325 nearest the map. Coconut Point (FLLEE03289) is further south-east and isn't used. The pier is the series' `level`; the other four are its `gauges`.
- High-water marks on Estero Island run from 11.6 to 13.8 ft NAVD88 (filteredhwms, event=325). They show the peak was nearly the same along the island, which is why one level is used everywhere.

**Lee County, *Hurricane Ian After-Action Report* (11 Aug 2023), pp. 9–10.** https://www.leegov.com/hurricane/Documents/AAR/Lee%20County%20Hurricane%20Ian%20AAR.pdf
- Mandatory evacuation of Zone A, parts of Zone B and mobile homes at 07:00 on 27 Sep. This is **minute 0**.
- All of Zones A and B at 08:45.
- Parts of Zone C at 13:45. WGCU reported "around 4 p.m." instead.
- An 18:30 text asked residents to be sheltered by 20:00.
- A shelter-in-place alert at 09:40 on 28 Sep.
- A 16:30 text told anyone with water coming in to go to the highest level.

**Reporting on the timing.** The News-Press (Miller & Persaud, 10 Oct 2022, https://news.yahoo.com/hurricane-ian-came-roaring-county-090007762.html) and NBC News (22 Nov 2022, https://www.nbcnews.com/news/us-news/hurricane-ian-florida-death-toll-rcna54069) report that Charlotte and Sarasota ordered evacuations on 26 Sep, a day before Lee. The CNN live blog of 3 Oct 2022 reports that the Town urged high-risk residents to leave on the morning of 26 Sep; that was advice, not an order.

**News-Press (Runnells), 28 Sep 2023.** https://news.yahoo.com/hurricane-ian-remembered-fort-myers-153414612.html
- 21 names were read at the Town's anniversary memorial.
- This is not an official count by cause.

**NOAA CO-OPS Fort Myers 8725520.** https://tidesandcurrents.noaa.gov/stationhome.html?id=8725520
- Hourly wind, used for `series.wind`.
- The same station's water level peaked at 2.30 m NAVD88 at 18:30, up the Caloosahatchee. We don't use it for the island.

**USGS 3DEP 1/3 arc-second DEM**, resampled to 6 m.

## Assumptions

- **Water level between sensors** *(assumption)*.
  - At each front's minute, every cell's water level is the inverse-distance-squared mix of the five sensors' levels at that minute, with each sensor's influence capped within 50 m of it.
  - So the Gulf side near the pier rises first and highest. San Carlos Island follows Matanzas Pass. The south end of the island follows Big Carlos Pass. Iona and McGregor follow Punta Rassa and Mullock Creek, which peaked lower and later.
  - The blend ignores the island in between. Behind the island the real water may have lagged the blended level.
- **Front times** *(assumption)*. Fronts are every 30 minutes from 09:00, and every 20 minutes from 14:00 to the last peak at 15:40.
- **Sampling** *(derived)*. Each record is sampled every 10 minutes, so short peaks are clipped. The pier's highest 10-minute sample is 3.85 m, 0.18 m under its 4.03 m filtered peak.
- **Fronts include the water** *(method)*. Each front is the Gulf and the bays plus the land the surge has reached at that minute. The beach and the small mangrove keys therefore sit inside one body of water, not along a shoreline that simplification could shave off.
  - An earlier build left the strip of Gulf beach (ground 1.0–1.6 m) outside every front, because simplification cut it off.
  - The rebuild checks this. Every cell within 120 m of open water with ground under 3.5 m is inside the peak front, and so is every cell between -1.3 and 1.5 m.
- **Outlines lean toward water** *(method)*. Each outline is grown by its simplification tolerance before it is simplified, so no flooded cell falls outside its front; the build reports zero for every front. The cost is that a front can claim a little dry ground at its edge: up to 40–50 m before noon, when the fractal mangrove shore needs the most simplification, and under 10 m from 14:40 on. Fronts carry up to 1,500 vertices.
- **Before deployment** *(no data)*. The sensors went in between 05:52 and 07:48 on 28 Sep. The series starts at its last dry reading (0.43–0.45 m, the sensor's orifice height) and holds that level before it.
- **No waves** *(assumption)*. The fronts use still water and leave out the waves riding on top. The unfiltered peak was 15.03 ft MHHW.
- **Today's ground** *(assumption)*. The DEM is today's ground, not September 2022's.
- **Fronts stop at the map's extent** *(assumption)*. Fronts are clipped to the extent baked in lib/cities.ts, which is the detail box 26.405–26.49 N, 81.995–81.88 W grown by 0.012°. That extent covers all of Estero Island, San Carlos Island, Iona and McGregor.
- **Wind** *(assumption)*. Wind comes from the Fort Myers gauge, 22 km inland, because no reliable wind record survives from the island.

## Deadline for the dispatch simulator

- **On time means aboard by 20:00 on 27 Sep (minute 780).** That is when Lee County told residents to be sheltered. Travel after that was into the storm, and the only ways off the island are the Matanzas Pass bridge and Big Carlos Pass.
- **Hard limit: the front that first contains the home.** The water itself reached the streets at about 10:38 on 28 Sep (minute 1658) and covered the island within about two hours. A pickup counted on the water alone would be judged against that limit, but nobody should plan for it, because nothing could drive there in hurricane winds.
