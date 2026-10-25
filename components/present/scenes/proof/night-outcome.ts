// The full-night simulation on the Eaton Fire's real record (data/eaton/night-sim-results.json, median
// of 5 runs; README table "Out on time with our system / today's process"). Units are at-risk
// households: homes that need a ride and that the fire reached, with a time on record.
// The script's two figures come from two different runs of that night, and each names its own:
//   today: calls start at the real 3:25 a.m. order, vans roll from 4 a.m., 25 vans (29 of 662)
//   ours: calls and vans start at 10:50 p.m., the first fire west of Lake, 50 vans (642 of 662)
// Like-for-like pairs from the same table, if the script changes:
//   10:50 p.m., 25 vans: today 39, ours 641
//   10:50 p.m., 50 vans: today 68, ours 642
//   3:25 a.m., 25 vans: today 29, ours 228
export const NIGHT_OUTCOME = {
  households: 662,
  today: { out: 29, setup: "Calls from the real 3:25 a.m. order, 25 vans" },
  ours: { out: 642, setup: "Calls from 10:50 p.m., the first fire west of Lake, 50 vans" },
} as const;
