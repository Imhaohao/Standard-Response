export type DisasterKind = "fire" | "hurricane" | "flood" | "tornado" | "freeze" | "heat";

// US disasters that forced or trapped people at home, each placed at the town or city it is known by.
// Puerto Rico (Hurricane Maria) is left out: the Albers USA projection has no place for it.
export const DISASTERS: { name: string; year: number; kind: DisasterKind; lat: number; lng: number }[] = [
  { name: "Eaton Fire", year: 2025, kind: "fire", lat: 34.19, lng: -118.15 },
  { name: "Camp Fire", year: 2018, kind: "fire", lat: 39.76, lng: -121.62 },
  { name: "Tubbs Fire", year: 2017, kind: "fire", lat: 38.44, lng: -122.71 },
  { name: "Almeda Fire", year: 2020, kind: "fire", lat: 42.25, lng: -122.79 },
  { name: "Maui fires", year: 2023, kind: "fire", lat: 20.88, lng: -156.68 },
  { name: "Marshall Fire", year: 2021, kind: "fire", lat: 39.98, lng: -105.13 },
  { name: "Smokehouse Creek Fire", year: 2024, kind: "fire", lat: 35.91, lng: -100.38 },
  { name: "Pacific Northwest heat dome", year: 2021, kind: "heat", lat: 45.52, lng: -122.68 },
  { name: "Texas winter storm", year: 2021, kind: "freeze", lat: 32.78, lng: -96.8 },
  { name: "Hill Country flood", year: 2025, kind: "flood", lat: 30.05, lng: -99.14 },
  { name: "Hurricane Harvey", year: 2017, kind: "hurricane", lat: 29.76, lng: -95.37 },
  { name: "Hurricane Katrina", year: 2005, kind: "hurricane", lat: 29.95, lng: -90.07 },
  { name: "Hurricane Michael", year: 2018, kind: "hurricane", lat: 29.94, lng: -85.41 },
  { name: "Hurricane Ian", year: 2022, kind: "hurricane", lat: 26.64, lng: -81.87 },
  { name: "Hurricane Helene", year: 2024, kind: "hurricane", lat: 35.6, lng: -82.55 },
  { name: "Hurricane Florence", year: 2018, kind: "hurricane", lat: 35.11, lng: -77.04 },
  { name: "Hurricane Sandy", year: 2012, kind: "hurricane", lat: 40.71, lng: -74.0 },
  { name: "Vermont floods", year: 2023, kind: "flood", lat: 44.26, lng: -72.58 },
  { name: "Eastern Kentucky floods", year: 2022, kind: "flood", lat: 37.25, lng: -83.19 },
  { name: "Joplin tornado", year: 2011, kind: "tornado", lat: 37.08, lng: -94.51 },
  { name: "Missouri River floods", year: 2019, kind: "flood", lat: 41.26, lng: -95.94 },
];

export type LabelSide = "right" | "left" | "above" | "below";
// A side, and how far the label slides up (negative) or down from centred on the mark.
export type LabelPlace = { side: LabelSide; shift: number };
type Box = { left: number; top: number; right: number; bottom: number };
export type Mark = { x: number; y: number; text: string };

// Sizes in stage pixels, matching the marks and the type-deck-note labels in us-scene.tsx.
export const MARK = 36;
const GAP = 8;
const LABEL_HEIGHT = 32;
const CHAR_WIDTH = 11.5;
const LABEL_PADDING = 20;
const SIDES: LabelSide[] = ["right", "left", "above", "below"];
const SHIFT = LABEL_HEIGHT * 0.75;
const PLACES: LabelPlace[] = [
  ...SIDES.map((side) => ({ side, shift: 0 })),
  ...(["right", "left"] as const).flatMap((side) => [{ side, shift: -SHIFT }, { side, shift: SHIFT }]),
];

const labelWidth = (text: string) => text.length * CHAR_WIDTH + LABEL_PADDING;

function labelBox(mark: Mark, { side, shift }: LabelPlace): Box {
  const { x, text } = mark;
  const y = mark.y + shift;
  const width = labelWidth(text);
  const half = MARK / 2;
  if (side === "right") return { left: x + half + GAP, top: y - LABEL_HEIGHT / 2, right: x + half + GAP + width, bottom: y + LABEL_HEIGHT / 2 };
  if (side === "left") return { left: x - half - GAP - width, top: y - LABEL_HEIGHT / 2, right: x - half - GAP, bottom: y + LABEL_HEIGHT / 2 };
  const top = side === "above" ? y - half - GAP - LABEL_HEIGHT : y + half + GAP;
  return { left: x - width / 2, top, right: x + width / 2, bottom: top + LABEL_HEIGHT };
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const markBox = ({ x, y }: Mark): Box => ({ left: x - MARK / 2, top: y - MARK / 2, right: x + MARK / 2, bottom: y + MARK / 2 });
const onStage = (box: Box) => box.left >= 0 && box.right <= 1920 && box.top >= 0 && box.bottom <= 1080;

function placeFor(mark: Mark, taken: Box[]): LabelPlace {
  const clear = PLACES.find((place) => {
    const box = labelBox(mark, place);
    return onStage(box) && !taken.some((other) => overlaps(box, other));
  });
  if (!clear && process.env.NODE_ENV !== "production") console.warn(`No clear label place for ${mark.text}`);
  return clear ?? PLACES[0];
}

// Each label takes the first side that clears every mark and every label placed before it, so the
// first marks (Altadena first) keep their natural place on the right.
export function placeLabels(marks: Mark[]): LabelPlace[] {
  const taken: Box[] = marks.map(markBox);
  return marks.map((mark) => {
    const place = placeFor(mark, taken);
    taken.push(labelBox(mark, place));
    return place;
  });
}
