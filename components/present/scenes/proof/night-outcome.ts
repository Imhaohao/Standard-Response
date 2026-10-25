// The full-night simulation on the Eaton Fire's real record (data/eaton/night-sim-results.json, median
// of 5 runs; README table "Out on time with our system / today's process"). Units are at-risk homes:
// homes that need a ride and that the fire reached, with a time on record. Swap in another row to
// change the slide. Like-for-like pairs from that table:
//   10:50 p.m., 8 vans: today 16, ours 195
//   10:50 p.m., 25 vans: today 39, ours 641
//   10:50 p.m., 50 vans: today 68, ours 642
//   3:25 a.m., 25 vans: today 29, ours 228
//   3:25 a.m., 50 vans: today 43, ours 356
export const NIGHT_OUTCOME = {
  homes: 662,
  today: 39,
  ours: 641,
  setup: "calls start at 10:50 p.m. with 25 vans",
} as const;
