# Lower Ninth Ward and Arabi: Industrial Canal breaches, Hurricane Katrina, 29 August 2005

All times are Central Daylight Time (UTC-5). Elevations are feet or metres NAVD88. IPET's water levels use the 2004.65 epoch, and the ground under them is today's USGS 3DEP DEM, also in NAVD88. The ward has subsided since 2005, so depths in the scenario can be off by a few tenths of a foot. Built by `modeling/scripts/cities/build_water_scenario.py --city lower-ninth` into `public/scenarios/lower-ninth.json`, from `timeline.json`, `series.json`, `neighborhoods.geojson` and `st-bernard-polder.geojson` in this folder.

## Sources and what we took

- **USACE IPET final report, Vol. IV *The Storm*** (https://biotech.law.lsu.edu/katrina/ipet/ipet.html)
  - pp. IV-32 to IV-34: the IHNC lock staff gauge peaked at about 14.3 ft at 09:00 and rose about 1 ft an hour overnight. IPET says that gauge is the only complete record of the canal.
  - Fig. 14: hourly lock readings. IPET publishes them only as a chart. **Derived:** we digitized the chart's vector markers (±0.05 ft) for `series.json` `ihncLock`.
  - pp. IV-194 to IV-199: the ward's flood evidence.
    - Site 3 and OP-5 saw water from about 04:30. OP-5 shut down at 05:30.
    - Clocks at Site C1, next to the north breach on ground at about -6 ft, stopped at 05:15 at +2 ft, and higher clocks stopped at 06:30.
    - Site C2, about 1 km east on higher ground, flooded from about 07:30.
    - Jackson Barracks was dry at 07:46 and flooded from 08:00. The water there peaked at 10.5 ft. The text says 14:45; the plotted point in Fig. 136 is about 13:42, and we use 13:42.
    - The ward and St. Bernard peaked at 10.5–11 ft.
    - IPET concludes one or both breaches failed before 05:30, possibly as early as 04:30.
  - Fig. 136, digitized, gives the ward's water level points in `series.json` `ward`.
  - Fig. 135 gives the relative positions of the sites. We read the distances off the figure; they are rough.
- **IPET Vol. V, App. 14, p. V-14-23**: a 250 ft north breach just south of Florida Ave, and an 850 ft south breach starting about 300 ft north of N. Claiborne Ave. Vol. IV App. 9 and the court give 180 and 793 ft. ILIT gives about 250 and nearly 900 ft. Team Louisiana gives 90 and 1,000 ft.
- **ILIT (Seed et al. 2006), Ch. 6** (https://biotech.law.lsu.edu/katrina/ILIT/report/CH_6.pdf): puts both breaches at 07:30–07:45, at a canal level of about 14–14.5 ft.
- **Team Louisiana (2007)** (https://levees.org/2/wp-content/uploads/2019/05/Team-LA-F26-FINAL-REPORT.pdf)
  - p. 67: "consensus" that the big south breach opened at 07:30.
  - pp. 29 and 91: Rita reopened the south breach and reflooded the ward on 24 September.
  - App. III: 73 victims recovered in the Lower Ninth, and 71 within a mile of the two breaches.
- **In re Katrina Canal Breaches, Doc. 20149** (https://biotech.law.lsu.edu/katrina/CanalCases/Orders/20149.pdf): north breach about 06:00 and south breach about 07:00. The 911 calls from the ward ran 06:53–08:03.
- **NHC TCR AL122005** (https://www.nhc.noaa.gov/data/tcr/AL122005_Katrina.pdf)
  - Landfall at Buras at 06:10 (1110 UTC) at 110 kt, and the final landfall at 09:45.
  - KNEW measured 60 kt sustained with a 75 kt gust at 06:53. Michoud measured a 107 kt gust at 09:15.
  - All floodwater was out of the city on 11 October.
- **House Select Committee, *A Failure of Initiative*, p. 108** (https://www.govinfo.gov/content/pkg/CRPT-109hrpt377/pdf/CRPT-109hrpt377.pdf), and the **NWS Katrina Service Assessment, p. 19**: Nagin's mandatory evacuation order came at about 11:00 on 28 August. Secondary accounts say 09:30–10:00. We use the federal reports' 11:00, which is minute 0.
- **IPET Vol. VI, p. VI-23**: St. Bernard unwatering was complete on about 15 September. No date is published for the Lower Ninth alone.
- **City of New Orleans neighbourhood statistical areas** (https://maps.nola.gov/server/rest/services/Reference/Reference_Layers/MapServer/0): the outlines of the Lower Ninth Ward and Holy Cross. They are the only area the water may enter.
- **St. Bernard Parish (Arabi).**
  - IPET Vol. IV pp. IV-196 to IV-199 says floodwater from the IHNC moved east through the Lower Ninth and merged with Chalmette's water near Paris Road "in the midmorning timeframe". Both areas peaked at 10.5–11 ft.
  - Chalmette's water came from the north-east from about 08:20 (the Channel 8 tower camera). Houses in Corinne Estates were 8–10 ft deep by 09:00–09:30, and the water peaked there at about 10.8 ft. All of these places are east of Paris Road and outside the map.
  - Team Louisiana pp. 66 and 80–81 adds three things:
    - Jackson Barracks in Arabi first saw water about 07:00, rising fast after 07:30.
    - The 40 Arpent back levee (crown 7–9 ft) overtopped massively from about 08:30 into St. Bernard *east of Paris Road*.
    - The IHNC breaches and the Caernarvon overtopping supplied about 10 percent of the St. Bernard basin's flooding.
  - Team Louisiana p. 81 puts Chalmette's high water about 0.5 ft above the Lower Ninth's.
- **OpenStreetMap St. Bernard Parish boundary (relation 1836430) and Forty Arpent Canal (way 977577408)** (https://www.openstreetmap.org/relation/1836430, ODbL). `st-bernard-polder.geojson` is the parish south of the canal, inside the map extent in `lib/cities.ts` (east edge -89.966, just short of Paris Road).
- **USGS 3DEP 1/3 arc-second DEM** (https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/), resampled to 5 m.

## How the fronts are made

1. The ward's water surface follows the `ward` points in `series.json`, linear between them.
2. A cell floods once that surface is above its ground and an unbroken path of lower cells joins it to an open breach.
3. The water front from each breach must also have had time to travel to the cell.
4. Water that has reached a cell stays.
5. Each outline is grown by its simplification tolerance before simplifying, so it covers every flooded cell. A front can claim up to 7–20 m of dry ground at its edge.

## Assumptions

- **Breach positions** (*assumption*). No source gives coordinates. North breach: about 100 m south of the Florida Ave bridge. South breach: the centre of an 850 ft stretch starting 300 ft north of the Claiborne Ave bridge. Both bridge positions come from OpenStreetMap, and both points are snapped to the ward's canal bank.
- **Breach openings** (*assumption*). Each opening is a disc of the breach's half-width plus 40 m, so it reaches across the levee.
- **North breach opens at 04:30** (*assumption*). This is IPET's earliest time, chosen because it gives the earliest deadlines.
- **South breach opens at 07:30** (*assumption*). This is Team Louisiana's "consensus" time.
- **North-breach spreading speed, 8 m a minute** (*assumption*). Water reached Site 4, roughly 0.5 km away, by 05:30, and C2, roughly 1 km away, only from 07:30. This speed reaches Site 4 on time and C2 about an hour early.
- **South-breach spreading speed, 105 m a minute** (*derived*). It is 3.1 km from the breach to Jackson Barracks, covered in 30 minutes (07:30 to 08:00).
- **The 06:30 level, +4.0 ft, held until Jackson Barracks' first reading** (*assumption*). Jackson Barracks' ground is about +4 ft, and it was dry at 07:46.
- **The ward's water surface is level** (*assumption*). The real surface sloped down from the breaches early on. The travel gate stands in for that slope.
- **Water after the peak is held at 10.5 ft** (*assumption*). The series ends at the peak, and the map holds it there. The ward stayed flooded for weeks.
- **Ground** (*assumption*). The DEM is today's ground, not 2005's. The floodwalls are too thin for it to see, which is why the ward outline is the boundary.
- **Arabi gets the same water surface as the ward** *(assumption)*.
  - The map extent ends just short of Paris Road. Inside it, IPET's account has Arabi's water coming from the west, out of the Lower Ninth. Team Louisiana's 40 Arpent overtopping entered St. Bernard east of Paris Road.
  - So the ward's level series and the south breach's travel gate carry on across the parish line into Arabi. The water stops at the 40 Arpent Canal, which is the polder's back edge.
- **Chalmette's water is a second source** *(assumption)*.
  - It crosses the domain's east edge from 10:00, at 105 m a minute. 10:00 is our reading of IPET's "midmorning".
  - By then the west water has already reached the same ground at the same level, so it changes no front. It is there so the merge IPET describes is in the model.
- **What is not modelled.** Chalmette and Meraux east of Paris Road, the wetland north of the 40 Arpent Canal, and the Upper Ninth west of the canal all flooded but are not modelled, because they are outside the map or have their own sources.

## Deadline for the dispatch simulator

- **On time means aboard and out of the ward before the scenario's water reaches the home**, meaning the first front that contains it.
- Once water arrives it gets deep within minutes, so there is no safe depth threshold to wait for. Site 2 went from water coming through the floor to 9 ft deep in about 15 minutes. Vans cannot drive in it either. Near the breaches the walls of water destroyed houses, and 71 of the ward's 73 victims were within a mile of them. The same rule applies in Arabi.
- **Hard cutoff: 04:30 on 29 August (minute 1050).** This is when the first water came in, with no warning. No van should be routed into the ward after it.
