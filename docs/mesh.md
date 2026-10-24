# Mesh add-on: phones that share, learn and move together

Three features built beside the core Rider Check flow. Nothing in the core flow reads or writes any of them: they have their own tables (`meshReports`, `meshModels`, `meshRound`), their own Convex module (`convex/mesh.ts`) and their own pages.

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

Each household that can leave is a particle (`lib/crowd/langevin.ts`):

```
dx = v dt
dv = [ (v_des(x, ρ) e(x) − v) / τ  +  F_rep(x) ] dt  +  sqrt(2 T / τ) dW
```

- **Direction e(x)** points to the next point on the driver's route. Route choice uses a potential over the street graph, φ(n): the fastest drive from intersection n to safety (any street south of 34.152° N), avoiding streets the fire has reached and the streets this driver believes are blocked, at a crawl past streets the fire reaches within 15 minutes. φ is one reverse Dijkstra over 1,851 intersections, under a millisecond, so every driver routes on exactly what its phone knows.
- **Congestion in route choice.** Drive times in φ are stretched by traffic. Every 5 minutes each street's car count is taken (half the previous count kept, so routes don't all swing at once) and its time multiplied by 1 / (1 − k/k_jam): the Greenshields law the dynamics drive by, with k_jam one car per 7.5 m of lane and a floor of 5% of free speed. Later drivers route around a jam.
- **Spreading drivers.** At each intersection a driver picks among the fastest street and every street that leads downhill in φ, with logit probabilities ∝ exp(−(drive time + φ at the far end) / 60 s). This is Dial's stochastic assignment: near-equal routes share the cars, and the downhill rule means no route loops.
- **Speed.** v_des is the street's free-flow speed slowed by local density (Greenshields: v_free (1 − ρ/ρ_jam), with ρ_jam = 0.02 vehicles per m²).
- **Repulsion.** F_rep is a soft exponential repulsion between vehicles (Helbing and Molnár's social force).
- **Noise.** T is the velocity noise variance: hesitation and the spread in how people drive.
- **Integration** is BAOAB splitting (Leimkuhler and Matthews 2013). The friction-and-noise part is solved exactly, which a test checks: the stationary velocity variance equals T.
- **Walls.** Blocked streets and burning ground are physical walls. A driver who runs into a blocked street it didn't know about is stopped, learns it, turns back and re-routes. Its phone makes a report.
- **Departures** follow a drift-diffusion decision, dX = μ(t) dt + σ dW, leaving when X reaches 1. There are two classes, evacuation-keen and evacuation-reluctant, per UC Berkeley's survey of California wildfire evacuees, and the drift rises as the fire nears.
- **Who stays.** Households that can't leave without help stay put and are shown in red. They are who the core flow is for.

The model also records flow by street: cars through each segment, their sampled speeds, and the driving time lost to crowding (each 30-second sample counts 30 s times the share of free-flow speed the car didn't get). The streets where crowding costs the most driving time come out as Lincoln Avenue, West Howard Street and the I-210 ramps.

### Traffic forecast for the agency

`npm run forecast:traffic` (`scripts/mesh/traffic-forecast.ts`) uses the same dynamics to tell the agency where traffic is heading, on `/mesh/agency`.

- **An ensemble follows the incident.** Six simulations of all 11,855 synthetic households (one worker thread each, seeds differ) run on the wall clock from the warning (`control.warningIssuedAt`), so each holds a plausible present: who has left, where the cars are.
- **Every 5 minutes, each is forked and run an hour ahead** (`CrowdSim.fork`): same state, fresh noise. The forecast is the spread across the six: cars on the road every 5 minutes, and for 0–15, 15–30 and 30–60 minutes ahead each street's slowdown (1 − mean speed / free-flow speed), cars through, and car-minutes lost to crowding. Every figure is a median with the 5th to 95th percentile over the runs.
- **What it knows.** Confirmed road closures and streets the phone mesh reports blocked, held fixed for the hour; the scenario fire keeps advancing as a wall. Blockages nobody has reported yet are not in it.
- **On the map**, streets forecast to slow are a wide soft ink band, darker meaning slower and wider meaning more driving time lost. Red stays fire and people.
- **Cost.** At minute 30, six runs take 190 s on one thread (measured); the runner puts each on its own thread. A runner started 517 minutes after the warning caught up and forecast in 85 s on a 10-core laptop. Keep at least five runs: with fewer, the range is just the spread of two or three samples.
- **Limits.** It forecasts the simulated town, not measured traffic: there is no live traffic feed, and the population is synthetic. It is advisory; Track C's dispatcher does not read it.

## Results (simulation, not a prediction)

`data/flow-results.json`. Four seeds, 3,497 synthetic households each (30% of Track D's population), five hours from the warning. Each figure is the median (5th to 95th percentile).

| | Mesh on | Mesh off | Difference |
| --- | --- | --- | --- |
| Phones that know of a blocked street, 30 min in | 1,715 | 524 | +1,332 (+1,160 to +1,349) |
| Phones that know of a blocked street, 60 min in | 2,589 | 837 | +1,836 (+1,666 to +1,849) |
| Drivers who drove into a blocked street unaware | 1,125 | 1,334 | −207 (−433 to −159) |
| Shared model, AUC ranking blocked streets | 0.94 | no model | |
| Same model fitted centrally on all raw data (no privacy) | 0.93 | 0.94 | |
| Time from a street blocking to the agency hearing, median | 15.2 min | 15.3 min | −0.5 (−1.4 to +1.2) |
| Households out of the zone | 3,010 | 3,011 | −1 (−23 to +6) |

What this does and doesn't show:

- **People in the zone learn about blocked streets far sooner, and fewer drive into them.** This is the mesh's clearest effect.
- **Private learning can only happen with the mesh.** Without phones mixing their updates, no phone ever holds five phones' worth, so nothing can be uploaded without exposing someone. With the mesh, the shared model matches a central fit on raw data to within 0.01 AUC in three of the four seeds and trails it by 0.04 in the fourth (0.89 against 0.92).
- **The agency's own coverage barely changes,** and how soon it hears of a blocked street moves by about a minute at most, either way across seeds. In these runs most blocked streets that phones see are seen by drivers, who upload directly once they reach safety. Streets that block around people still at home block after the area has emptied, when nobody passes to carry the news out. More gateways inside the zone (working cell service, or a fire engine running a gateway) is what would change this.
- **Evacuation totals don't move.** West Altadena's grid has plenty of detours, so a known blockage costs a driver little. The gain is in not being surprised. Denser blockages or a tighter grid would change that, and we haven't simulated it.

## How it got there

Recorded so nobody repeats it. The first version of the federated pipeline ranked streets worse than chance, AUC 0.2, even with the noise turned off. Five causes, each fixed:

- **Data reaching the agency was early-night data.** Phones contributed as soon as they had four observations (almost always "open"), and those stale updates kept pulling a model that had moved on. Fixed by refusing updates more than one version stale, and by letting a phone contribute again only once it has seen something new.
- **Mass never reached the upload threshold.** With symmetric push-sum, mass spread evenly at about one phone's worth each, and with many gateways it fragmented below the threshold. Fixed by letting mass flow toward heavier holders.
- **Rare features drowned in noise.** The noise is the same size in every direction of the weights, so a feature that is rarely nonzero carried a signal far below it. Fixed by standardising features on the phone, before clipping and noise, which raises that signal at no privacy cost. Preconditioning on the server instead amplifies the noise too; we tried it.
- **Label skew and client drift.** Fixed with full-batch steps and rare-event weighting, so phones that only ever saw open streets stop pushing once the model agrees with them.
- **The clip was about 25 times the typical update** (1 against a median of 0.04 near convergence). Lowered to 0.5.
