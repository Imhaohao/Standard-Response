import { slides } from "./script";

export type Position = { slide: number; beat: number };

const beatsIn = (slide: number) => slides[slide].beats.length;

export const start: Position = { slide: 0, beat: 0 };

export function advance(position: Position): Position {
  if (position.beat < beatsIn(position.slide) - 1) return { slide: position.slide, beat: position.beat + 1 };
  if (position.slide < slides.length - 1) return { slide: position.slide + 1, beat: 0 };
  return position;
}

export function retreat(position: Position): Position {
  if (position.beat > 0) return { slide: position.slide, beat: position.beat - 1 };
  if (position.slide === 0) return position;
  const slide = position.slide - 1;
  return { slide, beat: beatsIn(slide) - 1 };
}

export function last(): Position {
  const slide = slides.length - 1;
  return { slide, beat: beatsIn(slide) - 1 };
}

function clampIndex(value: number, count: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), count - 1);
}

// The URL counts from 1, the way the presenter says it: ?slide=2&beat=3.
export function parsePosition(slideParam: string | undefined, beatParam: string | undefined): Position {
  const slide = clampIndex(Number(slideParam ?? 1) - 1, slides.length);
  return { slide, beat: clampIndex(Number(beatParam ?? 1) - 1, beatsIn(slide)) };
}

export function toSearch(position: Position) {
  const params = new URLSearchParams({ slide: String(position.slide + 1) });
  if (position.beat > 0) params.set("beat", String(position.beat + 1));
  return `?${params}`;
}

export const beatAt = (position: Position) => slides[position.slide].beats[position.beat];
