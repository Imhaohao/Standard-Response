// The full-night simulation on the Eaton Fire's real record (data/eaton/night-sim-results.json, median
// of 5 runs; README table "Out on time with our system / today's process"). Units are at-risk
// households: homes that need a ride and that the fire reached, with a time on record.
// Both sides are the same night: calls and vans start at 10:50 p.m., the first fire reported west of
// Lake, with 25 vans. Only the process differs. Other pairs from the same table:
//   10:50 p.m., 50 vans: today 68, ours 642
//   3:25 a.m. (the real order), 50 vans: today 43, ours 356
export const NIGHT_OUTCOME = {
  households: 662,
  today: { out: 39 },
  ours: { out: 641 },
} as const;
