# Readiness survey add-on: what households can tell without telling

Decentralized data collection for disaster preparedness and prevention. It runs before any disaster, and nothing in the evacuation flow or the mesh add-on reads or writes it: it has its own tables (`prepareModels`, `prepareRounds`, `prepareTallies`), its own Convex module (`convex/prepare.ts`) and its own pages.

**The problem.** The facts that decide how a disaster goes for a household are the ones it least wants to hand over. Is the tap water safe? (After the Eaton fire, damaged pipes let benzene into Altadena's water.) Could you pay for a week away? Does someone at home need power for oxygen? A county that asks directly gets few answers, and holding them makes the county a target. This add-on lets the county learn the counts and train models from those answers while no answer ever leaves a phone.

| Page | What it is |
| --- | --- |
| `/prepare` | A household's phone: a home pin (kept on the phone), three topics of questions, consent per topic, the household's own risk from the shared model, nearby phones, pairing, and "Upload for others" |
| `/prepare/county` | What the county learns: shares by census block group with 95% intervals on the map, the two shared models as odds ratios, and what was uploaded |

| Code | |
| --- | --- |
| `lib/prepare/survey.ts` | The questions, by topic |
| `lib/prepare/areas.ts` | The 28 census block groups, and finding a pin's block group on the phone |
| `lib/prepare/tally.ts` | Randomized response, the count vector, the estimator and its interval |
| `lib/prepare/tasks.ts` | The two models, their features, client sampling and the training settings |
| `lib/prepare/mixing.ts` | The survey vector and push-sum mixing |
| `lib/prepare/node.ts` | A household's phone and its meeting protocol |
| `lib/prepare/county.ts` | The county's side: counts, rounds, versions (used by Convex and the simulation alike) |
| `lib/prepare/synthetic.ts` | Synthetic answers on the synthetic population, for the simulation |
| `scripts/prepare/simulate.ts` | A three-month campaign over every synthetic household |

```bash
npm run test:prepare                                   # 14 tests
npx tsx scripts/prepare/simulate.ts --seeds 3          # writes data/prepare-results.json, ~40 s
npx tsx --env-file=.env.local scripts/prepare/simulate.ts --publish   # one campaign through Convex, for /prepare/county
npx convex run prepare:clear                           # empties the survey tables only
```

## What a household shares, and how

Answers are kept on the phone. For each topic the household turns on, and once every question in it is answered (each has a "Not sure" or "No"), the phone adds two kinds of contribution to the survey:

**Counts, by randomized response.** Six yes-or-no items are counted, such as "can't pay for a week away" and "needs power for a medical device". Before an answer counts, the phone tells the truth with probability p = 0.8 and the opposite otherwise (Warner 1965). That is ε = ln 4 ≈ 1.39 local differential privacy per answer. The draw is made once per answer and kept (permanent randomized response, as in RAPPOR), so asking again learns nothing. The county estimates a share as `(said yes / answered − (1 − p)) / (2p − 1)`. Its 95% interval adds the coin's variance, p(1 − p) / (2p − 1)², to the sampling variance. Counts are kept per census block group (about 420 households each), the grain at which the census already publishes counts. The phone finds its block group from a home pin. The pin never leaves the phone.

**Model updates, by federated learning.** Two logistic regressions:

- *Unsafe tap water*: will this home's water fail a test? Features: private well, build year (before 1950, 1950–1985, unknown), lead or galvanized service pipe (or unknown), fire damage on the block, water changed lately. Households that have tested provide the labels. Every phone then shows its own home's risk from the shared model, worked out on the phone. The county can apply the model to what it already knows about every home (assessor build year, the water company's lead service line inventory) to decide where test kits and filters go first.
- *Can't afford to leave*: can this household not pay for a week away? Features: income band, renting, no car, no insurance for a place to stay, paid by the hour, household size. Most of these are published per block group by the census, so the county can apply the model where nobody answered.

Features are standardised by public constants. For each version, the county publishes a sample rate. Each phone decides once, at that rate, whether to train that version (client sampling), aiming at about 80 households per version. A picked phone takes one gradient step on its own answer, clips the change to norm 1, and adds N(0, 1.2²) to each coordinate before the change leaves the phone. A household trains at most 3 versions of each model.

**One vector, mixed between phones.** Everything a household sends is one vector per campaign: the count block (28 block groups × 6 items × [answered, said yes]), then for each model the update, the version it was trained on, and a 1 marking that an update is there. Phones mix these vectors with push-sum gossip (Kempe et al. 2003). Each phone holds a sum and a mass, and when two phones meet, one passes half of everything to the other. Mass is conserved and nothing is counted twice. Each phone learns from hellos how many meetings away the nearest gateway is, and mass flows downhill toward it, as in a sensor network's collection tree (Gnawali et al. 2009). A gateway is a household that agreed to upload for others while it has internet. It uploads once it holds 5 or more households' worth, and the county refuses anything smaller.

Why one vector and not a channel per model version: each version gets about 80 updates, spread one or two per gateway. In a channel of its own, no gateway would reach the floor of five and no model version would close. Folded in with everyone's counts, mixes are as dense as the counts are. An update is always hidden among five or more contributions, and the county reads each model block's own mass and average version back out.

Why routing by distance to a gateway: "give to whoever holds more", the rule the mesh add-on uses, piles mass onto ordinary phones that no gateway passes. In the simulation, that rule leaves 30% of what households send stuck on those phones. With the distance rule, 97% reaches the county.

**Messages between phones** carry no answer, area, pin or phone id. A hello has a fresh random session id, the model versions held, the mass held, whether the phone is a gateway, and its hop count. Every message is validated as untrusted input: vector length, finite numbers, "said yes" between zero and "answered", "answered" no more than the mass, update blocks within the norm that clipping and noise allow, and versions in range.

## The county's side

`lib/prepare/county.ts`, kept in Convex tables by `convex/prepare.ts`:

- Counts from each accepted mix are added to the campaign's running sums.
- Each model block goes into that model's open round, discounted by how far its average version is behind the current one (weight 1 / (1 + behind), refused past 12 behind; FedBuff-style asynchronous aggregation). Every 40 households' worth closes a round, and the average update is added to the model (DP-FedAvg, server step 1). The survey doesn't use FedAdam (the street model's optimizer) or server momentum. Both overshoot when a survey gets only 10–15 versions per model in three months.
- Each new version's sample rate is 80 divided by the number of households the counts say know the outcome (households that tested their water; households that answered the week-away question).

## Privacy, per household and topic

| What it shared | ε (δ = 10⁻⁵) |
| --- | --- |
| Counts for its topic (two answers, ln 4 each) | 2.77 |
| One model update (Gaussian mechanism, σ = 1.2 × clip) | 3.55 |
| Three model updates (composed exactly in Gaussian DP, Dong, Roth and Su 2019) | 6.73 |
| Counts plus three updates, added up (basic composition, an upper bound) | 9.51 |

In the simulation, the median household spent 2.77 per topic: most are never picked to train. These are local guarantees, against the phones it meets and against the county alike. They don't count the extra protection from sampling or from mixing, so the true loss is lower. The phone shows each topic's ε as it goes.

## Results (simulation, not a prediction)

Three seeds of a three-month campaign over all 11,855 synthetic households. About 4,400 take part (40%, fewer among lower incomes). Of those, 85% share water, 55% money and 70% health. 5% are gateways. A phone meets one of its 12 nearest participating neighbours with probability 0.25 an hour and downloads the public models with probability 0.1 an hour. The answers are synthetic: real ACS records for where people live, their ages, cars and medical needs, plus assumed rates and known outcome models (`lib/prepare/synthetic.ts`). Full numbers are in `data/prepare-results.json`.

| | Seed 1 | Seed 2 | Seed 3 |
| --- | --- | --- | --- |
| Reached the county | 96.8% | 96.9% | 96.9% |
| Uploads (mean households' worth) | 2,036 (6.1) | 2,002 (6.1) | 2,039 (6.2) |
| Water model AUC: federated / central on the same answers / central on everyone | 0.733 / 0.774 / 0.778 | 0.683 / 0.776 / 0.777 | 0.761 / 0.765 / 0.770 |
| Money model AUC: federated / central on the same answers / central on everyone | 0.757 / 0.775 / 0.777 | 0.738 / 0.782 / 0.783 | 0.763 / 0.779 / 0.781 |
| Versions (water, money) | 10, 14 | 10, 13 | 9, 13 |

AUC is scored on every household's true outcome, including those that never took part. "Central on the same answers" is what the county would get if every consenting household handed over its raw answers, which is exactly what this design avoids.

Counts, town-wide estimate against the truth among households that shared (seed 1): no three days of water 61% vs 61%; tap water failed a test 25% vs 28%; can't pay for a week away 33% vs 32%; no insurance for a stay 53% vs 55%; needs power for a medical device 3.9% vs 5.2%; cold medicine 8.0% vs 8.1%. Per block group, the 95% intervals covered the truth in 88–100% of block groups across items and seeds. They are wide, ±9 to ±24 points, because a block group has about 150 sharing households and the coin flips cost precision. That is the trade: an estimate per block group good enough to rank areas for test kits or generators, with nobody's answer known.

## Limits

- **Synthetic answers.** The outcome models and rates are assumptions. The results show the method recovers what is there, not what west Altadena would answer.
- **Who takes part.** Counts describe the households that shared. In the simulation, lower-income households take part less, and the raw count of "can't pay for a week away" is 2 points under the whole town's. Applying the money model to every household should correct this, but with 13–14 noisy versions its calibration swung between seeds (21–37% against a true 33–35%). We don't claim the correction.
- **Model calibration.** The models rank well (AUC above), but their average predicted risk can be off by several points, so the phone shows a household's risk as a guide, not a test result.
- **Area in the clear to the first phone.** A household's counts say which block group it is in, and the first phone it meets sees that unmixed. That phone is a neighbour, who already knows roughly where it is. The county only sees mixes.
- **Sybils.** Someone running many fake phones can add noise or skew counts within the bounds the checks allow. The norm and plausibility checks stop wild values, not a patient attacker.
- **Phones, not radios.** The browser version carries messages between tabs and over WebRTC between paired phones on a shared network (`lib/mesh/transport.ts`, `lib/mesh/webrtc.ts`, the same carriers as the mesh add-on).
