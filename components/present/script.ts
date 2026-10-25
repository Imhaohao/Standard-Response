// The deck's running order. Each slide steps through its beats one click at a time; the pitch
// script's A/V table numbers the same beats (1.0 is the title, 1.1 is Anthony, and so on).
export const slides = [
  { id: "story", beats: ["title", "anthony", "family", "night", "calls", "gone"] },
  { id: "scale", beats: ["everywhere", "eighty", "howSave", "stations", "dispatch", "built", "tenThousand"] },
  { id: "census", beats: ["zone", "census", "roseland", "testCall"] },
  { id: "voice", beats: ["ink", "sonic", "claude", "protocol"] },
  { id: "rescue", beats: ["request", "alns", "routes", "crowd", "jams", "maria"] },
  { id: "convex", beats: ["hub", "stress"] },
  { id: "proof", beats: ["nights", "today", "ours", "quote"] },
  { id: "close", beats: ["told", "reached", "everyone", "saveLives", "wordmark"] },
] as const;

export type Beat = (typeof slides)[number]["beats"][number];

const beatOrder: readonly Beat[] = slides.flatMap((slide) => slide.beats);

export function isAtOrAfter(beat: Beat, milestone: Beat) {
  return beatOrder.indexOf(beat) >= beatOrder.indexOf(milestone);
}

export function isBetween(beat: Beat, first: Beat, last: Beat) {
  const at = beatOrder.indexOf(beat);
  return at >= beatOrder.indexOf(first) && at <= beatOrder.indexOf(last);
}
