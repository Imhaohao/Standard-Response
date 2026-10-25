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
- Those two sensors are the `gauges` in the series.
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

- **One water level everywhere** *(assumption)*. The pier record is applied to every cell. The other sensors peaked 0.35–0.53 m lower and 30–55 minutes later than the pier. That means the scenario floods the bay side of the island somewhat early and somewhat deep, which is the safe direction.
- **Sampling** *(derived)*. The record is sampled every 10 minutes. The highest 10-minute sample is 3.85 m, 0.18 m under the 4.03 m filtered peak. The last front uses the 3.85 m sample.
- **Before 05:52 on 28 Sep** *(no data)*. The sensor wasn't deployed until then. The series starts at its last dry reading (0.43–0.45 m, the sensor's orifice height) and holds that level before it.
- **No waves** *(assumption)*. The fronts use still water and leave out the waves riding on top. The unfiltered peak was 15.03 ft MHHW.
- **Today's ground** *(assumption)*. The DEM is today's ground, not September 2022's.
- **Fronts stop at the map's extent** *(assumption)*. Fronts are clipped to the extent baked in lib/cities.ts, so the south end of Estero Island isn't drawn.
- **Wind** *(assumption)*. Wind comes from the Fort Myers gauge, 22 km inland, because no reliable wind record survives from the island.

## Deadline for the dispatch simulator

- **On time means aboard by 20:00 on 27 Sep (minute 780).** That is when Lee County told residents to be sheltered. Travel after that was into the storm, and the only ways off the island are the Matanzas Pass bridge and Big Carlos Pass.
- **Hard limit: the front that first contains the home.** The water itself reached the streets at about 10:38 on 28 Sep (minute 1658) and covered the island within about two hours. A pickup counted on the water alone would be judged against that limit, but nobody should plan for it, because nothing could drive there in hurricane winds.
