// The night runs on a clock anyone on the rescue map can pause or speed up. It is anchored at the
// last change: from `realAt` on the wall clock it reads `simAt`, and it moves `speed` times faster
// than the wall clock from there. Every time the app stores or compares is on this clock. The wall
// clock only paces the simulation loop and limits how long the loop runs, which `ranMs` counts.

export type SimClock = { speed: number; realAt: number; simAt: number; ranMs: number };

export const PLAYBACK_SPEEDS = [1, 10, 30, 60] as const;

export function simTime(clock: SimClock | undefined, real: number) {
  if (!clock) return real;
  return clock.simAt + (real - clock.realAt) * clock.speed;
}

// Wall-clock time the loop has spent running, leaving out the time it sat paused.
export function runningMs(clock: SimClock, real: number) {
  return clock.ranMs + (clock.speed > 0 ? real - clock.realAt : 0);
}

export function clockAtSpeed(clock: SimClock | undefined, speed: number, real: number): SimClock {
  return { speed, realAt: real, simAt: simTime(clock, real), ranMs: clock ? runningMs(clock, real) : 0 };
}
