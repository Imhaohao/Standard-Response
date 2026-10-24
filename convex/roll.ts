// A random stream keyed by a string. Convex seeds Math.random the same way on every run of a
// function with the same arguments, so a scheduled tick would roll the same dice forever. Stand-ins
// key their dice on the row and the attempt instead.
export function seededRandom(key: string) {
  let state = 2166136261;
  for (let i = 0; i < key.length; i++) state = Math.imul(state ^ key.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
