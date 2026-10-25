# Paradise: Camp Fire, 8 November 2018

All times are Pacific Standard Time (UTC-8) on 8 November 2018 unless a date is given.

## Sources

### NIST TN 2135, the fire progression timeline (primary)

Maranghides A, Link E, Mell W, Hawks S, Wilson M, Brewer W, Brown C, Vihnaneck B, Walton WD (2021). *A Case Study of the Camp Fire – Fire Progression Timeline.* NIST Technical Note 2135. https://doi.org/10.6028/NIST.TN.2135 (PDF: https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.2135.pdf)

The task brief names "NIST Technical Note 2252" as the progression timeline. That number is NIST's later NETTRA report (below). The minute-by-minute progression with its 2,200+ observations is TN 2135.

What we took:

- **Appendix F, Fire Spread Data (report pages 256–366).** Every fire observation with date, start time, observation window in minutes, latitude, longitude, type (spot, vegetation, residential, commercial, other) and the residual-fire flag. `modeling/scripts/cities/paradise_observations.py` extracts 2,708 rows into `nist-observations.json`. Some rows are duplicates across NIST's 15 overlapping focus regions; we drop exact duplicates (same time, place and text). NIST's own footnote says some points look like duplicates because several sources saw the same thing.
- **Appendix B, Burnover Data.** 19 places where fire burned over a road, with time span and coordinates, extracted into `nist-burnovers.json`. The ten inside the Paradise frame are in the scenario as `roadBurnovers`.
- **Sec. 16.3.1 and the Executive Summary.** First 911 report 06:25. Fire cresting the ridge toward Concow shortly after 07:00. First structures burning in Concow at 07:25. First spot fires in Paradise at 07:50, 12 km from the origin. Main front reaches Pentz Rd around 08:30. 30 spot fires in Paradise before 08:30, reaching 3.4 km into town. Honey Run Canyon spot fire at 08:45, 6.3 km from Lowry Ln. By 10:00 fire is impacting Pentz, Bille, Pearson and Clark Roads with civilians trapped in vehicles. Around noon fire approaches Bille Rd and Skyway. By 13:00 it is well established through most of town and impacting downtown. By 15:00 it is burning the west side of Skyway between Black Olive Dr and Jewell Rd. Sunset is 16:56.
- **Sec. 16.3.2, spread rates.** 0.55 m/s overall from Pulga to Highway 99. 1.1 m/s from the origin to Concow. 7.8 m/s effective by spotting into Paradise. NIST says in-town rates "will have very large uncertainties" and gives no single in-town figure.
- **Sec. 5.3, weather.** At ignition the Jarbo Gap RAWS reported 8 m/s (18 mi/h) wind gusting to 18 m/s (40 mi/h) at 23 % relative humidity. During the day on 8 November, gusts were around 13 m/s (30 mi/h), sustained winds 5–9 m/s (12–20 mi/h) from the northeast, and humidity dropped to 10 %.
- **Sec. 2, Table 1.** 62,053 ha (153,336 acres) burned, 18,804 structures destroyed (13,696 single-family homes), 85 civilian deaths.

### NIST TN 2252, notification, evacuation, traffic and refuge (NETTRA)

Maranghides A, et al. (2023). *A Case Study of the Camp Fire — Notification, Evacuation, Traffic, and Temporary Refuge Areas (NETTRA).* NIST Technical Note 2252. https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.2252.pdf

What we took:

- **Table 10, the notification timeline.** Pulga order 06:55. Concow warning 07:22. First Paradise warning (Pentz Rd: Zones 3, 8, 14, Lower Pentz) 07:32. Concow order 07:37. **First Paradise order 07:46 (same zones), minute 0 of this scenario.** CodeRED for the Pentz Rd zones 07:57. Orders extended to Zones 2, 7, 13 and Morgan Ridge 08:01. At 08:03 Butte ECC told Paradise PD that all of Paradise was under mandatory evacuation, and from then 911 operators and officers told every zone to leave. IC named the remaining Paradise zones and most of Magalia at 08:49.
- **Sec. 6.2.** The first 911 report of fire inside Paradise came at 07:49. Paradise residents had been calling about the smoke column since 07:12.
- **Table 11.** First fire observation per evacuation zone. Examples: Zone 8 at 07:49, Zone 3 at 07:50, Zone 6 at 07:57, Zone 7 at 08:00, Zones 11 and 12 at 08:30, Zones 4 and 9 at 08:41, Zone 13 at 09:00, Zone 10 at 10:30.
- **Sec. 11 and Tables 63–64, fatalities** (compiled by NIST from the Butte County DA's grand jury report, Sheriff's releases and news). 85 deaths. Average and median age 72, range 20 to 99, and only 16 were under 65. 74 of the 85 (87 %) were found at home: 59 inside and 15 outside. 10 were found in or beside a vehicle. At least 36 (42 %) had a reported mobility or medical condition, and nearly all of them were found at home. At least 19 were believed to be evacuating when the fire overtook them, and nearly all of those were in Concow or eastern Paradise (Pentz Rd and Edgewood Ln).

### Butte County District Attorney, The Camp Fire Public Report (June 2020)

https://web.archive.org/web/20210903004619/http://www.buttecounty.net/Portals/30/CFReport/PGE-THE-CAMP-FIRE-PUBLIC-REPORT.pdf (the live buttecounty.net copy returns 403)

What we took:

- PG&E recorded an interruption on the Caribou-Palermo 115 kV line at 06:15. The first 911 call reached CAL FIRE ECC at 06:25:19. The report says "at 7:44 a.m., the fire reached the Town of Paradise".
- **"A total of 84 lives were lost as a direct result of the fire."** We tallied the DA's 84 entries by hand. The DA publishes no totals, so these counts are ours.
  - By community: 64 in Paradise, 9 in Magalia, 9 in Concow, and 1 in Butte Creek Canyon.
  - In Paradise: 48 were found inside a home, 8 outside their own home, 6 in or beside a vehicle, and 2 outdoors away from home.
  - Ages: median 72. 66 of the 83 with a known age were 65 or older.
  - 16 entries mention a walker, a wheelchair, a disability, or not being able to drive.
- **Victim locations file.** https://web.archive.org/web/20220309060121/https://www.buttecounty.net/Portals/30/CFReport/Camp-Fire-Victim-Locations.kmz has 82 placemarks. `modeling/scripts/cities/paradise_fatalities.py` discards names and exact points and keeps counts per 0.01° cell in `fatalities.json`; 70 of the 82 are inside the frame. Before discarding the points, the script measures, for each location, the time from minute 0 to the first NIST observation within 250 m. 47 locations have one. For those, the median is 134 minutes, the quartiles are 50 and 223 minutes, and the minimum is 7. 8 had fire within 250 m inside 30 minutes of the first order, and 14 inside an hour.

### CAL FIRE

- Incident page, https://www.fire.ca.gov/incidents/2018/11/8/camp-fire/: start 06:33 at Pulga Rd and Camp Creek Rd. 153,336 acres, 18,804 structures destroyed, 754 damaged, 85 civilian deaths. Contained 25 Nov 2018 at 08:00.
- ECC "Camp Incident Chronology 11/8/18" (redacted, hosted by NIST), https://www.nist.gov/system/files/documents/2020/11/16/ECC%20Camp%20Inc%20Chronology%20of%20events_Redacted.pdf. Entries we used:
  - 07:44, a call at Drayer Dr and Pentz Rd reporting three spot fires.
  - 07:45, "extending the mandatory evac zone to east of Pentz Rd 3, 8, 14". The ECC called the Sheriff's Office at 07:46.
  - 08:01, "The fire is now in Paradise … about 2000 acres along Pentz Rd".
  - 08:02, "Immediate Mandatory Evacuations for all of Paradise".
  - 08:25, "FRH now impacted with fire".
  - 08:45, "fire progressed approx. ½ way through Paradise".
  - 12:00, "Wagstaff and Skyway is being impacted by fire".
- Green Sheet 18-CA-BTU-016737, https://www.firefighterclosecalls.com/wp-content/uploads/2018/12/18-CA-BTU-016737-Camp-Green-Sheet.pdf. The fire covered more than 55,000 acres in its first 12 hours, "about 76 acres per minute". Daytime gusts were 25–35 mph and humidity fell to about 10 % by afternoon.

### Warnings that did not reach people

- **CapRadio, 11 Jul 2019**, https://www.capradio.org/articles/2019/07/11/emergency-alert-will-you-be-notified-if-a-wildfire-is-heading-toward-your-town/
  - In the first 150 minutes, the county's CodeRED system tried 28,600 calls to 15,000 numbers. 64 % went through, a third were answered by a person, and 36 % (about 5,400 numbers) did not go through.
  - Paradise Town Hall sent its first alert at 08:48.
  - Zones 4, 9 and 10 were never sent CodeRED.
  - It took 15–40 minutes to relay orders from incident command to the public.
- **Cal OES After Action Report**, https://www.caloes.ca.gov/wp-content/uploads/Preparedness/Documents/FINAL-AAR-2018-Camp-Fire-508-Clean-Copy-11.17.25.pdf
  - "of the 52,000 residents who evacuated the foothills, only 7,000 had received an emergency notification through the county's CodeRed system."
  - "Most of the destruction occurred within the first four hours."

This is the gap Standard Response is meant to fill: an order existed at 07:46–08:03, but most households never received it from the system.

### CAL FIRE final perimeter

National Interagency Fire Center, *InterAgency Fire Perimeter History, All Years* feature service, record OBJECTID 50567: INCIDENT "CAMP", source CALFIRE, unit CABTU, 153,335.6 acres, dated 2018-11-26. https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0

What we took: the final burned area, used only to clip the fronts so no front claims fire outside what burned.

### Town limits

US Census TIGERweb, Places layer, GEOID 0655520 (Paradise town): extent −121.6557 to −121.5645 longitude, 39.7254 to 39.8015 latitude. The scenario frame is that extent plus about 1 km on each side.

## How the fronts are built

`modeling/scripts/cities/paradise_fronts.py` writes `fronts.geojson`.

1. We keep NIST observations dated 8 November whose observation window is 60 minutes or less (2,159 of 2,708). Each observation's time is the start of its window, the same convention NIST uses on its maps.
2. Each observation says fire was at a point by its time. We treat fire as reaching ground around it at a constant speed from then on, so the area reached by clock time *t* is the union of discs around every observation made by *t*, of radius speed × (*t* − observation time). This is the same as arrival(x) = min over observations of (time + distance / speed).
3. That union is clipped to the CAL FIRE final perimeter and the Paradise frame. Specks under 2,000 m² are dropped, and each front is simplified to about 300 vertices or fewer. Each front is unioned with the one before it so the fronts stay nested.
4. There are 15 fronts, at 07:50, 08:00, 08:15, 08:30, 08:45, 09:00, 09:30, 10:00, 10:30, 11:00, 12:00, 13:00, 14:00, 15:00 and 17:00. Their `minutesAfterWarning` values are 4, 14, 29, 44, 59, 74, 104, 134, 164, 194, 254, 314, 374, 434 and 554.

Several fronts are MultiPolygons because Paradise burned from dozens of separate spot fires, not one line. `lib/ink-map/fire-field.ts` currently keeps only the largest polygon of each front, so early spots outside the main blob are dropped there.

## Assumptions

- **Assumption: minute 0 is 07:46**, the first evacuation order covering Paradise households. NIST TN 2252 Table 10 gives 07:46, and the ECC log has the request at 07:45 with the call to the Sheriff at 07:46. The first warning (07:32) and the town-wide order (08:02 in the ECC log, 08:03 in NIST) are both in `timeline.json`. The LA Times says 09:17 for a "full-scale" order. We follow the ECC log and NIST.
- **Assumption: spread speed of 12 m/min (0.2 m/s) between observations.** NIST does not publish an in-town rate (TN 2135 Sec. 16.3.2). We chose the speed by holding out each NIST "first sighting" in turn and predicting its time from all the other observations. A first sighting is an observation inside the frame with no earlier one within 200 m; there are 306. At 12 m/min, 7.2 % of first sightings came more than 30 minutes before the modelled arrival, and 11.4 % more than 15 minutes before. The median modelled arrival is 64 minutes *earlier* than the first sighting. A first sighting always lags the true arrival, so earlier is the safe direction.

  Here is how the other speeds we tried compare, counting first sightings that came more than 30 minutes before the modelled arrival:

  | Speed | Share more than 30 min early |
  | --- | --- |
  | 3 m/min | 34 % |
  | 6 m/min | 16 % |
  | 8 m/min | 12 % |
  | 15 m/min | 5 % |
  | 22 m/min | 1.3 % |

  At 22 m/min the fronts cover 81 of the frame's roughly 104 km² by 10:00, which contradicts NIST's account that downtown along Skyway was not impacted until after noon. Even at 12 m/min the fronts are early downtown. They reach Almond St and Andover Dr at 10:00, Adrian Dr at 10:30, and Town Hall and Black Olive Dr at 11:00. NIST first mentions those places at 15:02, 14:00, 12:58, 14:00 and 15:44. Fire converges on downtown from several directions in this model, so expect deadlines there to be conservative by 2 to 4 hours. The check numbers are in `fronts.geojson` under `metadata.check`.
- **Assumption:** every row NIST classed as a fire observation counts, including ember showers and smoke seen from a canyon rim. Embers were the main way homes in Paradise ignited (TN 2135 Sec. 11), so an ember shower counts as the hazard arriving.
- **Assumption:** an observation's start time is when fire was there. For windows up to 60 minutes this can move a point up to an hour earlier than the latest it could have been.
- Unburned islands inside the perimeter are not modelled. The final perimeter is one outline, so surviving homes inside it still get an arrival time.
- The fronts show where fire could have reached by a time, consistent with what was seen. They do not show that every structure inside a front burned at that time.

## Deadlines for the dispatch simulator

**On time** means the whole party is aboard **10 minutes before the first NIST fire observation within 250 m of the home**, falling back to 500 m where nothing was seen within 250 m. When neither exists, use the arrival time from the fronts minus 10 minutes. This is the rule the Eaton replay uses (`dispatch/sim/eaton_night.py`, `FIRE_NEAR_M`, `FIRE_FAR_M`, deadline "fire nearby minus 10 min"). NIST's Appendix F points are the same kind of evidence as the FSRI sightings used there: first reports that lag the real arrival. That makes every deadline a little late, which flatters any dispatch policy equally.

The reason for being aboard *before* fire is near, rather than "before the house burns", comes from NIST's fatality data. 19 of the 85 victims died while trying to leave, outside or in vehicles, nearly all in eastern Paradise and Concow where fire arrived early. NIST also documents roads burning over with civilians on them: Pentz Rd 08:45–11:15, Pearson Rd 09:15–10:15, Bille Rd 09:25–11:45, Skyway from 08:30 and Clark Rd from 10:00 (`roadBurnovers`). A pickup that boards someone just as fire arrives still has to drive out through it. The 10-minute margin is the time to load and clear the block. Most victims were found at home, and at least 42 % had a mobility or medical condition, so the people this deadline is for are the ones who can't self-evacuate.

A route also fails if it crosses a road burnover that is active at that minute. The simulator should close those road segments for each burnover's `startMinutesAfterWarning` to `endMinutesAfterWarning`. Where NIST gives no end (`null`), the segment stays closed.
