# Buffalo: blizzard of 23–25 December 2022, East Side

All times are Eastern Standard Time (UTC-5) in December 2022 unless a date says otherwise.

## Why this scenario has no moving front

A blizzard does not advance across a city the way a fire does. The danger for someone who can't leave home is losing two things:

1. **Being reached.** No ordinary vehicle, ambulance or fire truck can get to their street.
2. **Heat.** Their power, and with it most furnaces, goes out.

We model both against time. The spatial `fronts` hold the time the East Side became **unreachable**. Heat loss is a city-wide time series, because no published source maps outages below "East Buffalo" and "South Buffalo".

## Sources

### NWS Buffalo

- **Winter Weather Messages (WSW)** in the IEM AFOS archive, https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?pil=WSWBUF&sdate=2022-12-19&edate=2022-12-27&limit=200&fmt=text
  - Blizzard Warning issued 03:54 on Thu 22 Dec, in effect 07:00 Fri 23 Dec to 07:00 Sun 25 Dec. Forecast: "Total snow accumulations of 1 to 3 feet. Winds gusting as high as 70 mph … flash freeze on Friday", with wind chills to 10–20 below.
  - At 05:45 on 25 Dec the warning for Erie County was replaced by a Winter Storm Warning until 04:00 on 26 Dec.
- **Public Information Statements (PNS)**, same archive, https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?pil=PNSBUF&sdate=2022-12-21&edate=2022-12-31&limit=100&fmt=text
  - Airport peak gust: "Buffalo Airport 72 MPH 0940 AM 12/23 ASOS". Other gusts were 79 mph at 3 NW Lackawanna (10:10) and 65 mph at the Buffalo harbor gauge (14:30).
  - Lowest wind chill: "Buffalo Airport -19 F 0454 PM 12/23".
  - Running snowfall at the airport: 8.1 in by 15:00 on 23 Dec, 12.2 in by 19:00, 27.8 in by 09:00 on 24 Dec, 34.6 in by 21:00, 43.0 in by 06:55 on 25 Dec, and 49.2 in by 10:00 on 26 Dec. Storm total: "Buffalo Airport 51.9 in 0908 PM 12/27".
  - No spotter report is labelled Buffalo city or East Side. The nearest storm totals are Kenmore 0.8 NW at 32.5 in, West Seneca 2.8 ENE at 33.5 in, Lancaster 0.3 S at 35.3 in and Williamsville 3.8 E at 37.6 in.
- **Winter Summary 2022–23**, https://www.weather.gov/media/buf/Winter_Summary_2022_23.pdf
  - "gusted over 65 mph at 8:39 am on the 23rd, heralding the onset of a historic blizzard".
  - "The 37 consecutive hours of blizzard conditions … from early on December 23rd and into the late evening hours of December 24th".
  - "The band of lake effect snow extended from the City of Buffalo to the Buffalo Airport and remained stationary for over a day."
  - "Zero visibility made snow removal unsafe, forcing snow removal to be halted on the 23rd and 24th."
  - "Many side streets throughout northern erie county were not completely plowed until the 26th and 27th".

### Station data at Buffalo Niagara International Airport (KBUF)

- **Hourly METARs** from the Iowa Environmental Mesonet ASOS archive (URL in `modeling/scripts/cities/buffalo_weather.py`). These give temperature, wind, gust, direction, visibility, present weather, and IEM's wind chill. They are written to `kbuf-hourly.json`, and `scenario.json` carries them as `series.hourlyKBUF`.
  - Rain turned to snow between the 06:54 and 07:54 reports on 23 Dec.
  - 39 routine hourly reports, from 08:54 on 23 Dec to 23:54 on 24 Dec, have visibility at or below 1/4 mile with wind or gust at or above 35 mph. That's our count from the data; NWS's own figure is 37 consecutive hours.
  - Visibility was 0.00 mi in every hourly report from 13:54 to 17:54 on 23 Dec.
- **GHCN-Daily** for USW00014733 from NOAA NCEI, written to `kbuf-daily.json`.

  | Date | Daily snowfall | Snow depth |
  | --- | --- | --- |
  | 23 Dec | 22.3 in | 1.2 in |
  | 24 Dec | 17.9 in | 18.1 in |
  | 25 Dec | 2.8 in | 27.2 in |
  | 26 Dec | 7.3 in | 27.2 in |
  | 27 Dec | 1.6 in | 28.0 in |

  The fastest 5-second gust on 23 Dec was 72 mph.

### NYU Wagner review for the City of Buffalo

*Lessons Learned from the Buffalo Blizzard* (June 2023), https://wagner.nyu.edu/files/faculty/publications/NYU%20Buffalo%20Blizzard%20Report%20-%20June2023_0.pdf

- **Timeline (pp. 39–47).**
  - Erie County travel ban announced 08:45 and in effect 09:30 on 23 Dec. BUFFALERT sent it at 09:58.
  - NYSDOT routes closed at 06:00, with gates shut at 09:00. The Thruway closed to non-commercial traffic at 14:00.
  - "3:00 p.m.: Whiteout conditions began in Buffalo, stopping roadway operations."
  - On the night of 23 Dec, DPW switched to bucket high-lifts "due to snow height".
  - At 07:00 on 25 Dec, "DPW plowed primary streets to allow National Grid to repair damaged substations"; the medical corridor followed at 15:00.
  - National Grid began restoring power at 12:00 on 25 Dec.
  - "By end of day [28 Dec], DPW had taken at least one pass at clearing every city street."
  - Power was fully restored at 23:30 on 28 Dec.
- **City power outages (pp. 41–46, p. 79).** The hourly series of National Grid customers out in the City of Buffalo is in `reported.json`. It starts at 34 at 08:30 on 23 Dec and peaks at 20,890 at 18:00 on 23 Dec, still about 20,000 through the 24th. It falls to 9,302 by midnight on the 26th and 485 by 22:00 on the 27th.
- **Substations (p. 88).** "Of the three affected substations, two were in East Buffalo and one in South Buffalo. The three substations combined serviced about 10,000 customers."
- **911 (pp. 140–144).**
  - 6,119 calls from inside the city from 23 to 26 Dec, 1,736 of them from District E. "Sectors C and E cover the East Side of Buffalo."
  - Average response took 22.72 hours citywide, 30.21 hours in District E and 22.28 hours in District C.
  - Calls placed on the afternoon of 23 Dec waited 40 hours on average in District E and 34 hours in District C.
  - There was a backlog of 1,100 calls, and the dispatch software could show only 25 at once.
- **Deaths (p. 12).** "Of the 31 individuals who died within the City of Buffalo, 20 were people of color."

### New York State after-action review

NYS DHSES / Guidehouse (August 2023), https://www.dhses.ny.gov/system/files/documents/2023/08/nys-aar-on-buffalo-blizzard-response.pdf

- "Erie County and NYSDOT instituted a full driving ban … at 9:30am."
- "multiple substations froze over and went offline in Buffalo's East Side". There were more than 33,000 outages in Erie County.
- The county asked for the National Guard "on the evening of Friday, December 23"; members arrived later on Saturday and on Sunday morning.
- "By Tuesday December 27, the region-wide travel ban was reduced to a travel advisory. Notably, the City of Buffalo maintained its travel ban."
- "I-190 and State routes 5, 33, and 198 would fully open at midnight" going into 29 Dec.

### News reports

- **WIVB**, the Erie County medical examiner's final count, https://www.wivb.com/weather-news/buffalo-blizzard-2022/erie-county-medical-examiner-confirms-three-more-blizzard-related-deaths-bringing-total-to-47/amp/
  - 46 deaths in Erie County, 47 counting one in Niagara County. 35 were in Buffalo and 11 in the suburbs.
  - Causes:

    | Cause | Deaths |
    | --- | --- |
    | Found outside in the snow | 18 |
    | No power or heat | 12 |
    | Delayed EMS response | 7 |
    | Found in a vehicle | 4 |
    | Snow-blowing or shoveling | 4 |

  - 25 of the dead were Black, 20 white and 1 Hispanic.
- **WKBW**, https://www.wkbw.com/news/local-news/blizzard-of-22/driving-ban-in-the-city-of-buffalo-to-be-lifted-early-thursday-morning: the city driving ban was lifted at 00:01 on Thu 29 Dec.
- **AP (via WSLS)**, https://www.wsls.com/news/politics/2022/12/28/explainer-how-blizzard-stunned-even-winter-wise-buffalo/: "At one point Saturday, almost every fire truck in Buffalo was stranded … residents … were told emergency services were unavailable."

### Indoor temperature without heat

Urban Green Council with Atelier Ten, *Baby It's Cold Inside* (2014), https://www.urbangreencouncil.org/wp-content/uploads/2022/11/2014.02.05-Baby-Its-Cold-Inside.pdf. In a modelled winter blackout using New York City weather from 19–26 January 2013, "a typical single-family house would be 35°F after three days" and "would fall below freezing on the fourth day". The report calls that week "a cold spell, but not an unusual or extreme one".

## How the series and fronts are built

`modeling/scripts/cities/buffalo_weather.py` downloads the station data. `modeling/scripts/cities/buffalo_scenario.py` writes `scenario.json`.

- **Snowfall.** The storm total at the airport is interpolated linearly between the NWS checkpoints above and the NCEI midnight totals (22.3 in at midnight on the 23rd, 40.2 on the 24th, 43.0 on the 25th, 50.3 on the 26th). Snowfall rate is the change over the past hour. The airport sits under the same band as the city (NWS: the band "extended from the City of Buffalo to the Buffalo Airport").
- **Snow depth.** Daily only, as NCEI publishes it. Depth is not interpolated, because wind packed and drifted the snow and depth is not the running total.
- **Streets by class.** See the table below; each time carries its source.
- **Fronts.** One polygon covering the East Side frame at minute 330 (15:00 on 23 Dec), when whiteout stopped road operations.

| Street class | OSM `highway` | Unusable from | First reopened |
| --- | --- | --- | --- |
| Expressway (I-190, NY 33 Kensington, NY 198 Scajaquada) | motorway, trunk and links | closed 06:00 on 23 Dec, gates 09:00 | midnight 28–29 Dec |
| Arterial (Main St, Genesee St, Bailey Ave, Broadway, William St, Walden Ave) | primary, secondary, tertiary | impassable 15:00 on 23 Dec | first plow pass 07:00 on 25 Dec; legally open 00:01 on 29 Dec |
| Side street | residential, unclassified, living_street | impassable 15:00 on 23 Dec | first plow pass by end of 28 Dec; legally open 00:01 on 29 Dec |

## Assumptions

- **Assumption: minute 0 is 09:30 on 23 Dec**, when the county travel ban took effect. The blizzard warning (03:54 on 22 Dec) and its start (07:00 on 23 Dec) are in `timeline.json`.
- **Assumption: every street on the East Side became impassable to ordinary vehicles at 15:00 on 23 Dec.** The NYU timeline says whiteout "stopping roadway operations" began then. We found no source that gives an earlier time for side streets or a later one for arterials, and no source that says when any particular East Side street drifted shut. That's why the front is one polygon and not a progression. The frame is a provisional East Side box (west −78.870, south 42.870, east −78.795, north 42.945) until the city's `detail` box lands in `lib/cities.ts`.
- **Assumption: the airport's snowfall and wind stand in for the East Side.** No NWS report is labelled for the East Side. The NWS says the band covered the city and the airport together.
- **Assumption: "Friday evening" for the National Guard request is placed at 20:00, and "at one point Saturday" for stranded fire trucks at 12:00.** Both events are flagged `timeIsApproximate` in `timeline.json`.
- City outages are city-wide counts. Two of the three failed substations were in East Buffalo, but we found no map of which streets they served.
- **Not found:**
  - A published count or map of deaths by neighborhood. The East Side concentration is documented for 911 calls, response times, plow requests and substations, not for deaths.
  - A dated announcement of when city EMS resumed.
  - The exact closure time of the Kensington Expressway.
  - Any NWS report of drift heights.

## Deadlines for the dispatch simulator

A household is **on time** if it is reached before the first of these:

1. **Its street becomes impassable: 15:00 on 23 Dec (minute 330).** After that, no ordinary vehicle reaches it until the street's first plow pass. For an arterial that's 07:00 on 25 Dec (minute 2,730); for a side street it's the end of 28 Dec (minute 8,069). The NYU review measured an average 911 wait of 30.21 hours in District E, and 40 hours for calls placed on the afternoon of the 23rd. A household that misses minute 330 is effectively waiting for the plows. Seven of the county's deaths are attributed to delayed EMS response.
2. **Twelve hours after the home loses heat, or at once if someone in it depends on powered equipment.** Assumption: 12 hours is our number, not a published one. Urban Green's modelled typical single-family house reached 35°F after three days, but in a milder New York cold spell. Buffalo's airport recorded 4–12°F with sustained winds mostly 25–45 mph through the 24th, so a house there loses heat faster. And the people this is for are older or ill, so they come to harm well before a house reaches freezing. Twelve of the 46 county deaths were attributed to no power or heat. For someone on home oxygen or another powered device, the loss of power itself is the emergency, so that deadline is the minute the power goes out. City outages rose from 3,177 customers at 10:00 to 20,890 at 18:00 on the 23rd. Without per-street outage data, a simulated household's power-loss time should be drawn from that rising curve.

Under these rules, the realistic window for the dispatch simulator is minute 0 to minute 330: five and a half hours on 23 Dec. In that window a household that can't ride out a multi-day outage has to be moved to a warming center or hospital, and anyone who depends on powered equipment has to be checked on. Most of the deaths happened after that window closed. This scenario shows what could be done before the roads shut, and shows plainly what no fleet could do after.
