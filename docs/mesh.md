# Mesh add-on: phones that share, learn and move together

Three features built beside the core Rider Check flow. They have their own tables (`meshReports`, `meshModels`, `meshRound`, `meshTrafficForecasts`), their own Convex module (`convex/mesh.ts`) and their own pages. The core flow reads one thing from them: the traffic forecast, which sets the dispatcher's drive times and so the ETAs riders hear (see "In the dispatcher's drive times" below).

1. **Road reports shared phone to phone.** A resident marks a street blocked or open. The report spreads to nearby phones with no internet and no server, and reaches the agency when any phone carrying it gets a connection.
2. **Federated learning over that mesh.** Phones train a street-blockage model on what they saw. Updates are noised on the phone, mixed with other phones' updates as phones meet, and uploaded only as mixes of at least five phones. The agency gets a model, never anyone's observations or identity.
3. **Langevin dynamics for the flow of people.** Evacuating households move as particles under underdamped Langevin dynamics on the real west Altadena street graph, routing around the fire and the blockages their phone knows about.

| Page | What it is |
| --- | --- |
| `/mesh` | A resident's phone: tap a street, say blocked or open, pair with a phone nearby, opt in to training and uploading |
| `/mesh/agency` | What the agency has received, street by street, where the shared model expects blockages nobody has reported, and the traffic forecast for the next hour |
| `/flow` | A simulated night on the map, mesh on or off, with the multi-seed results beside it |

| Code | |
| --- | --- |
| `lib/mesh/` | Reports, sync protocol, federated learning, privacy accounting, transports (pure TypeScript, tested) |
| `lib/crowd/` | Street grid, route choice, Langevin dynamics, departure model, ensemble traffic forecast |
| `lib/flow/` | The simulated night that joins the three, and its ground-truth blockages |
| `convex/mesh.ts` | Anonymous uploads, rounds, the shared model, the traffic forecast, queries for the agency |
| `components/mesh/` | The three pages. Every panel is tagged with the technology it runs on, with a "How it works" note (`technology.tsx`) |
| `scripts/mesh/` | `simulate.ts` (writes `data/flow-results.json`), `traffic-forecast.ts` (the live forecast runner), `feature-scale.ts` |

```bash
npm run test:mesh                                    # 36 tests: protocol, privacy, learning, transports, crowd model, forecast
npm run forecast:traffic                             # the live traffic forecast for /mesh/agency, every 5 minutes
npx tsx scripts/mesh/simulate.ts --seeds 4 --sample 0.3   # about 2 minutes
npx convex run mesh:clear                            # empties the mesh tables only
```

## 1. Road reports between phones

**A report** is `{ id, segment, status, cause?, observedAt, hops }`. `segment` is an undirected street segment (the road graph's edge key with the two OSM node ids in ascending order, so both directions of a street are one segment). `observedAt` is rounded down to the minute. `id` is random and made per report, so the same report reaching a phone twice counts once; it is not a phone id. There is no phone id, no name, no position beyond the street, and no uploader id anywhere.

**Merging.** Each phone holds a grow-only set of reports keyed by id, so two phones that have heard the same reports in any order hold the same set. The store is bounded (12 reports per segment, 4,000 in all, six hours) and trims deterministically, oldest first.

**What a street's status is.** A time-decayed vote: every report counts `0.5^(age / 90 min)`, blocked against open. Below a total weight of 0.25 the street is "unknown". A newer "open" outvotes an older "blocked", so a reopened street reads as open. A lone report counts for about three hours.

**A meeting between two phones** (`lib/mesh/node.ts`):

1. Both send `hello`: a fresh random session id, a 64-bit order-independent digest of their report ids (two FNV-1a hashes XORed over the set), their model version, and how much aggregation mass they hold.
2. If the digests differ, each sends the ids it holds, then each sends the reports the other lacks. Phones that already agree exchange about a hundred bytes.
3. The phone with the newer model sends it.
4. Aggregation mass moves (section 2).

Every message from a peer is validated as untrusted input: report shape, segment key format, times within ten minutes of now and six hours back, hop counts, sizes of every list, finite numbers within bounds.

**How bytes move** (`lib/mesh/transport.ts`, `lib/mesh/webrtc.ts`). The protocol doesn't care. Two carriers work in a browser today:

- **WebRTC with QR-code pairing, no server.** One phone shows its offer as a QR code, the other scans it and shows its answer, the first scans that. With no ICE servers the phones connect over host candidates, so they need a shared local network (the same Wi-Fi or one phone's hotspot) and nothing beyond it. Descriptions are trimmed to host candidates and deflate-compressed to about 640 characters per code. Scanning uses the browser's `BarcodeDetector` where there is one and jsQR elsewhere; pasting the code works too. Verified end to end in headless Chrome, both on the bare transport and through the `/mesh` page itself in two separate Chrome processes that share nothing but the network: codes shown and pasted, both phones showing "1 paired", and a report made on one arriving on the other over WebRTC alone. The same run passes with both browsers emulating an Android phone (393 × 852 screen, mobile user agent, the street picked with real touch events). The camera path is checked too: with Chrome's fake camera playing a video of phone A's QR code, phone B's scanner read the code by camera (no pasting), answered, and the phones paired. That code was 867 characters, a 101-module QR code, so on real phones hold the screens close and steady. Not yet tried on two physical phones. Browsers name local addresses with mDNS (`*.local`); where the network or OS blocks mDNS the phones can't connect, and the page says so after 25 seconds instead of hanging. On macOS the usual cause is a browser without the Local Network permission (System Settings, Privacy & Security, Local Network): we checked that Chrome's `*.local` names never resolve on such a Mac while the Mac's own name does. Phone browsers on a shared Wi-Fi or hotspot normally resolve them.
- **Tabs on one device** over `BroadcastChannel`, for demoing several phones on one screen. A broadcast hello starts a one-to-one meeting with addressed replies, so mass is never delivered twice. One tab owns the saved phone through a Web Lock; any other tab is a separate phone in its own session storage, because two tabs restoring the same phone would duplicate its aggregation mass.

A native app would carry the same messages over Bluetooth LE or Wi-Fi Aware, which reach phones without a shared network. That is the next step; nothing in the protocol changes.

## 2. Federated learning over the mesh

**The model** is a logistic regression for "this street is blocked" from seven features a phone can compute offline: bias, fire within 30 minutes and fire arrived (from the fire scenario in the warning), minor road, lanes, hours since the warning, and the share of streets within 400 m this phone believes blocked. Features are centred and scaled by public constants (their mean and spread over every street for the first five hours, from the road graph and the fire scenario; `scripts/mesh/feature-scale.ts`).

**On the phone** (`lib/mesh/federated.ts`, `lib/mesh/node.ts`), with the person's opt-in:

- Observations (the streets they report, and in the simulation the streets they pass) stay on the phone as labelled examples.
- For a model version it hasn't contributed to, once it has at least four new observations since its last contribution, the phone takes three full-batch gradient steps from the shared weights. Blocked observations count ten times (they are a few percent of what anyone sees).
- The change is clipped to L2 norm 0.5, and Gaussian noise with standard deviation 1.5 × 0.5 is added to every coordinate. This is local differential privacy: even an update seen unmixed by a neighbour is already private.
- A phone contributes at most six times. Gaussian mechanisms compose exactly in Gaussian differential privacy (mu adds in quadrature), so the most any phone gives away is **ε = 7.8 at δ = 10⁻⁵** (2.75 for one contribution; `lib/mesh/privacy.ts` computes the exact Balle-Wang conversion).

**Between phones.** Each contribution is a pair (sum, mass) with mass 1. In a meeting, the phone holding less of a version sends the other half of it. Mass is conserved, so the ratio sum ÷ mass remains the average of everything mixed in (push-sum gossip, Kempe et al. 2003), and mass gathers on a few phones instead of spreading thin. A **gateway** (a phone with internet whose owner turned on "Upload for others") counts as heaviest, so mass flows to it. A gateway uploads a version only once it holds at least five phones' worth, and the server refuses anything smaller. Mass for versions more than one behind is dropped.

**At the agency** (`lib/mesh/rounds.ts`, `convex/mesh.ts`). Uploads accumulate in an open round. At 40 phones' worth the model takes one FedAdam step (Reddi et al. 2021) with server learning rate 0.3. Per-coordinate step sizes matter here: without them the fire terms barely move. A mix built on the previous version counts at half weight, and older ones are refused. Uploads with impossible norms are refused as well.

**Threat model.**

| Who | Sees | Doesn't see |
| --- | --- | --- |
| The agency | Anonymous reports; sums over at least five phones of noised updates; the gateway's IP address at upload | Which phone made any report; any phone's observations; any single update |
| A phone you meet | The reports you carry; half of the aggregation mass you hold, which may be mostly your own noised update; a random session id that changes every meeting | Your observations; anything that links this meeting to the next |
| Someone watching uploads | That some phone uploaded | Whose reports they were |

Known limits, stated plainly: there is no defence yet against a phone that floods fake reports (Sybil) or uploads poisoned mixes beyond norm bounds. Models aren't signed, so a malicious peer could offer a fake "newer" model; signing models with an agency key is the fix. A report's street and minute say where somebody was, roughly when.

## 3. Langevin dynamics for the flow of people

Each household that can leave is a particle (`lib/crowd/langevin.ts`). Velocity is written in the car's own frame, along its heading e(x) (a) and across it (c):

```
dx   = v dt
dv_a = [ (v_des − v_a) / τ  +  λ w (v_lead − v)_a  +  F_rep,a ] dt  +  sqrt(2 s T / τ) dW_a
dv_c = [ −v_c / τ_c  −  k_lane d_c  +  F_rep,c ] dt                  +  sqrt(2 s T_c / τ_c) dW_c
```

- **Direction e(x)** points 15 m ahead on the driver's street (pure pursuit), so a car that drifts sideways steers back. Route choice uses a potential over the street graph, φ(n): the fastest drive from intersection n to safety (any street south of 34.152° N), avoiding streets the fire has reached and the streets this driver believes are blocked, at a crawl past streets the fire reaches within 15 minutes. φ is one reverse Dijkstra over 1,851 intersections, under a millisecond, so every driver routes on exactly what its phone knows.
- **Congestion in route choice.** Drive times in φ are stretched by traffic. Every 5 minutes each street's car count is taken (half the previous count kept, so routes don't all swing at once) and its time multiplied by 1 / (1 − k/k_jam): the Greenshields law the dynamics drive by, with k_jam one car per 7.5 m of lane and a floor of 5% of free speed. Later drivers route around a jam.
- **Spreading drivers.** At each intersection a driver picks among the fastest street and every street that leads downhill in φ, with logit probabilities ∝ exp(−(drive time + φ at the far end) / 60 s). This is Dial's stochastic assignment: near-equal routes share the cars, and the downhill rule means no route loops.
- **Speed.** v_des is the street's free-flow speed slowed by the density of the road ahead (Greenshields: v_free (1 − k/k_jam)). k is read from the gap to the nearest car ahead in the driver's lane within 20 m: k = 1 / gap, against route choice's k_jam of one car per 7.5 m of lane. Past 10 m the gap counts for less, down to free flow at 20 m, so speed never jumps as a car comes into view. Cars on a crossing street, oncoming cars and the cars behind don't slow a driver, so the front of a queue pulls away at speed. (It used to count every car in a 30 m box around the driver, which held a queue's front car to a crawl.)
- **Safe time gap.** A driver also keeps at least the jam spacing plus T = 1 s of driving to the car ahead in its lane: v_des ≤ (gap − 7.5 m) / T, the congested branch of Newell's car following. It sees that car at any distance: each step the cars on each street are sorted by lane and by how far along they are, and past the street's end the car ahead is the last one on the street the driver turns onto. Greenshields alone tops out at v_free / (4 × 7.5 m) a lane, so a freeway lane let a queue through at 3,600 cars an hour, 1 s apart at 29 m/s. Now a town lane's queue goes at about 1,800 an hour and a freeway lane's at 2,100, as real ones do. A car closer than the jam spacing wants to stand still, where before it crept on at 5% of free speed into the car ahead.
- **Turns.** A driver picks the street it will turn onto as it enters the one before (on what it knows then; it picks again at the corner if that has changed), so it sees the turn coming. Ahead of every corner, a bend in a street or a turn at its end, it brakes at the rate needed to take it at sqrt(a_lat R), a_lat = 3 m/s² and R the arc a driver steering 15 m ahead cuts the corner on, 15 m / (2 sin(θ/2)), and no faster than the street it turns onto. Corners within comfortable braking distance (2 m/s²) count. A right-angle turn comes out at about 20 km/h. Before this, cars took right-angle turns at a median 43 km/h, some at freeway speed, so intersections cost nothing.
- **Repulsion.** F_rep is a soft exponential repulsion between vehicles (Helbing and Molnár's social force), weighted by where the other car is: 1 straight ahead, 0.1 straight behind, (1 + cos φ)/2 between. It is capped at 8 m/s², about the hardest a car brakes. Before this, the car behind pushed the car ahead as hard as it was pushed back, so a long queue shoved its front car past the speed limit (up to 49 m/s in a full-population run).
- **Speed matching.** λ = 0.5 s⁻¹ pulls a driver toward the speed of the car ahead (the full velocity difference model, Jiang, Wu and Zhu 2001), weighted by how near it is. Following on the gap alone sets off stop-and-go waves this steep a speed law can't damp.
- **Right of way and braking.** Where two cars' paths meet, the one further into the other's path goes first, and the other brakes for it; without this, two cars meeting at a corner each brake for the other and neither moves. The same rule picks whom a driver follows on another street or in another lane, and in its own lane the car ahead is the one further along it, so no two cars ever wait for each other. (Once cars stopped creeping, 661 of 1,018 stopped cars in a full-population run were in such loops, one of 131 cars.) Braking can bring a car to a stop within a step but never drives it backwards.
- **Bridges.** Cars meet only cars on the same street, on a street sharing an intersection with it, or off the streets. Two streets that cross with no intersection cross on a bridge (182 such crossings, most at the freeway), so a queue on an overpass doesn't hold up the street below.
- **Lanes.** Each car drives a lane: right of the centreline on a two-way street, spread across a one-way street, 3.5 m wide. Entering a street it takes the lane with the most room ahead, the one nearest it among equals. Across the heading, velocity relaxes in τ_c = 0.5 s (against τ = 2 s along it), and a spring of k_lane = 0.5 s⁻² pulls the car back to its lane's line, d_c being how far off it is. That holds a car in its lane even standing still, when steering does nothing. Cars in one lane are in single file: they push each other only along the lane, by the distance along it, and a car follows the car ahead in its lane however far across the noise or a turn has put it. Cars on other streets or in other lanes push by how far across the heading they are: fully within a car's width (2 m), not at all a lane apart, and only 30% of that push is kept across the heading. Before lanes, every car kept to the centreline, so the two directions shared it, a three-lane street carried one file, and a jammed one-lane street squeezed its queue two or three abreast: a car creeping up the queue can't be pushed back, so the push it got across the street was all that was left. One jammed street held 68 cars where it has room for 35. In a full-population run, lanes got 7,501 households out in the first hour instead of 7,427, with a median drive of 7.5 minutes instead of 8.4.
- **Noise.** T = 0.6 m²/s² along and T_c = 0.15 m²/s² across are the velocity noise variances for a driver with open road: hesitation and the spread in how people drive. Both scale with the driver's pace s = v_des / v_free, so a car standing in a jam doesn't jitter. When it did, the queue ahead turned that jitter into a ratchet: a jammed car could only wander backwards, and whole queues crept back into the yards.
- **What that changed.** In a full-population run, cars more than 5 m off their street fell from about 25% to 5% of those moving, and the farthest 1% from 50–70 m to about 10 m. A stopped queue on one lane discharges at 1,800 cars an hour, a city lane's saturation flow; before, followers shoving leaders gave 3,940. Streets jam more, because cars queue in their lane instead of overtaking through the yards.
- **Integration** is BAOAB splitting (Leimkuhler and Matthews 2013). The friction-and-noise part is solved exactly on each axis, which a test checks: the stationary velocity variance equals T.
- **Walls.** Blocked streets and burning ground are physical walls. A driver who runs into a blocked street it didn't know about is stopped, learns it, turns back and re-routes. Its phone makes a report.
- **Departures** follow a drift-diffusion decision, dX = μ(t) dt + σ dW, leaving when X reaches 1. There are two classes, evacuation-keen and evacuation-reluctant, per UC Berkeley's survey of California wildfire evacuees, and the drift rises as the fire nears.
- **Pulling out.** A car that leaves drives from the house to the nearest point on the nearest street slower than 72 km/h (not onto the freeway or its ramps), at yard speed, and joins it in whichever direction it drives, by the same logit odds on the time to safety as at an intersection. Before, every car crossed the yards to the nearest intersection, a median 67 m away against 31 m to the street. In a full-population run that got 7,272 households out in the first hour instead of 6,990. 1,020 of the 11,855 synthetic homes (9%), mostly on the west edge, are more than 200 m from any street in the road graph; they still cross a long way of yards, as they did before.
- **Who stays.** Households that can't leave without help stay put and are shown in red. They are who the core flow is for.

The model also records flow by street: cars through each segment, their sampled speeds, and the driving time lost to crowding (each 30-second sample counts 30 s times the share of its open-road speed the car didn't get). A speed sample is the car's velocity along its route, not |v|, which counted a car turning a corner, or one jittering in a jam, as making way. That had under-counted lost time by about 15%. The open-road speed is how fast the same car would be driving at that point of its route with nobody else on the road: its own speed law, corners and all, run without the noise and the other cars. Against the street's free speed instead, slowing for a turn or pulling away from a driveway counted as traffic: with each household driving alone, 10% of driving time came out lost to crowding, now 2%. Slowdowns in the forecast are measured the same way. The streets where crowding costs the most driving time come out as the I-210 ramps, Windsor Avenue, West Howard Street and Arroyo Boulevard, then Lincoln Avenue.

### Traffic forecast for the agency

`npm run forecast:traffic` (`scripts/mesh/traffic-forecast.ts`) uses the same dynamics to tell the agency where traffic is heading, on `/mesh/agency`.

- **An ensemble follows the incident.** Six simulations of all 11,855 synthetic households (one worker thread each, seeds differ) run on the wall clock from the warning (`control.warningIssuedAt`), so each holds a plausible present: who has left, where the cars are.
- **Every 5 minutes, each is forked and run an hour ahead** (`CrowdSim.fork`): same state, fresh noise. The forecast is the spread across the six: cars on the road every 5 minutes, and for 0–15, 15–30 and 30–60 minutes ahead each street's slowdown (1 − mean speed / mean open-road speed, so corners aren't traffic), cars through, and car-minutes lost to crowding. Every figure is a median with the 5th to 95th percentile over the runs.
- **By direction.** Each window also gives the slowdown of each direction of each street (the road graph's directed edges), with members that had too few cars on it to measure counted as free flow. Evacuees drive out, so the lanes heading in are mostly clear. The medians go to their own small table, `meshDriveTimes`, which the dispatcher reads on every re-plan.
- **What it knows.** Confirmed road closures and streets the phone mesh reports blocked, held fixed for the hour; the scenario fire keeps advancing as a wall. Blockages nobody has reported yet are not in it.
- **On the map**, streets forecast to slow are a wide soft ink band, darker meaning slower and wider meaning more driving time lost. Red stays fire and people.
- **Cost.** At minute 30, six runs take about 100 s on one thread (measured: 14 s to reach minute 30, 84 s to run each an hour ahead); the runner puts each on its own thread, so a forecast takes about 15 s. With the earlier dynamics, a runner started 517 minutes after the warning caught up and forecast in 85 s on a 10-core laptop. Keep at least five runs: with fewer, the range is just the spread of two or three samples.
- **Clock.** Minute 0 is the warning on the night's clock, so a paused or sped-up night is followed; each forecast records where on that clock it starts (`baseAt`).
- **Limits.** It forecasts the simulated town, not measured traffic: there is no live traffic feed, and the population is synthetic.

### In the dispatcher's drive times

`convex/traffic.ts` turns the newest forecast into the time a vehicle takes to drive each street: `1 / max(0.05, 1 − slowdown)` times its free-flow time, using the ensemble median for that direction in the window the drive reaches it, and the last window past the hour. A drive that crosses from one window into the next covers the rest of the street at the next window's speed, so leaving later never arrives sooner and Dijkstra stays exact. The re-planner (the solver's matrix, the accepted-run forecast, revocations, ETA updates) and the simulated vans' road paths all use these times, so the ETA in a rider's callback is the drive through the traffic the model expects, and the van on the map drives it. Vans get no right of way. With no forecast for this incident, or one older than 15 minutes, every street is at free flow, as before. One approximation: the solver's matrix prices each leg as if it set out now; every re-plan prices again from the present. `lib/crowd/traffic.test.ts` tests it.

Measured offline on the full synthetic population (4 members, forecasts made 10 and 20 minutes after the warning, 400 homes that need a ride, one shelter south of the zone): drives from the shelter into the zone barely change (median 6.1 min either way, the worst 1.3 times longer), while drives from those homes back to the shelter, with the evacuation, take a median 1.3 to 1.4 times longer (6.5 min becomes 7.7 to 7.9), up to 1.8 times.

## Results (simulation, not a prediction)

`data/flow-results.json`. Four seeds, 3,497 synthetic households each (30% of the synthetic population), five hours from the warning. Each figure is the median (5th to 95th percentile).

| | Mesh on | Mesh off | Difference |
| --- | --- | --- | --- |
| Phones that know of a blocked street, 30 min in | 1,460 | 438 | +1,022 (+955 to +1,314) |
| Phones that know of a blocked street, 60 min in | 2,378 | 768 | +1,569 (+1,521 to +1,868) |
| Drivers who drove into a blocked street unaware | 829 | 1,144 | −193 (−356 to −144) |
| Shared model, AUC ranking blocked streets | 0.74 | no model | |
| Same model fitted centrally on all raw data (no privacy) | 0.75 | 0.76 | |
| Share of the blocked streets phones saw that the agency knows | 0.80 | 0.64 | +0.20 (+0.01 to +0.23) |
| Time from a street blocking to the agency hearing, median | 15.6 min | 18.0 min | −2.0 (−2.4 to −0.8) |
| Households out of the zone | 2,924 | 2,947 | −7 (−97 to +4) |

Regenerated on the Eaton Fire scenario, after the crowd model's turns, lanes and safe time gap (section 3). On the seed-7 fire, where phones came to know of about three times as many blocked streets (115 against about 40), the shared model and the central fit both reached 0.93.

What this does and doesn't show:

- **People in the zone learn about blocked streets far sooner, and fewer drive into them.** This is the mesh's clearest effect.
- **Private learning can only happen with the mesh.** Without phones mixing their updates, no phone ever holds five phones' worth, so nothing can be uploaded without exposing someone. With the mesh, the shared model is within 0.01 AUC of a central fit on raw data in one seed, ahead of it by 0.06 in another, and behind it by 0.10 and 0.12 in the other two (0.71 and 0.63 against 0.83 and 0.73). The central fit is as low as the shared model: on this fire fewer blocked streets reach phones, so there is less to learn from, private or not.
- **The agency hears about 2 minutes sooner with the mesh, in every seed (0.8 to 2.4), and knows of more of the blocked streets phones saw** (80% against 64%, median), though how many more varies from 1 to 23 points across seeds. Most blocked streets that phones see are seen by drivers, who upload directly once they reach safety. Streets that block around people still at home block after the area has emptied, when nobody passes to carry the news out. More gateways inside the zone (working cell service, or a fire engine running a gateway) is what would change this.
- **Evacuation totals don't move.** West Altadena's grid has plenty of detours, so a known blockage costs a driver little. The gain is in not being surprised. Denser blockages or a tighter grid would change that, and we haven't simulated it.

## How it got there

Recorded so nobody repeats it. The first version of the federated pipeline ranked streets worse than chance, AUC 0.2, even with the noise turned off. Five causes, each fixed:

- **Data reaching the agency was early-night data.** Phones contributed as soon as they had four observations (almost always "open"), and those stale updates kept pulling a model that had moved on. Fixed by refusing updates more than one version stale, and by letting a phone contribute again only once it has seen something new.
- **Mass never reached the upload threshold.** With symmetric push-sum, mass spread evenly at about one phone's worth each, and with many gateways it fragmented below the threshold. Fixed by letting mass flow toward heavier holders.
- **Rare features drowned in noise.** The noise is the same size in every direction of the weights, so a feature that is rarely nonzero carried a signal far below it. Fixed by standardising features on the phone, before clipping and noise, which raises that signal at no privacy cost. Preconditioning on the server instead amplifies the noise too; we tried it.
- **Label skew and client drift.** Fixed with full-batch steps and rare-event weighting, so phones that only ever saw open streets stop pushing once the model agrees with them.
- **The clip was about 25 times the typical update** (1 against a median of 0.04 near convergence). Lowered to 0.5.
