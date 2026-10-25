import type { Frame } from "@/components/map/projection";
import { BUILDING_KIND, InkMapData, Point } from "@/lib/ink-map/data";

// How much ground the sign-up map shows at first: a few blocks, so one house is big enough to tap.
const STREET_SCALE_METERS = 420;
const MIN_NAME_LENGTH = 3;

const DIRECTION_WORDS: Record<string, string> = { n: "north", s: "south", e: "east", w: "west", north: "north", south: "south", east: "east", west: "west" };

const STREET_TYPES: Record<string, string> = {
  st: "street", street: "street", ave: "avenue", av: "avenue", avenue: "avenue", dr: "drive", drive: "drive",
  rd: "road", road: "road", blvd: "boulevard", boulevard: "boulevard", ln: "lane", lane: "lane", pl: "place",
  place: "place", ct: "court", court: "court", ter: "terrace", terrace: "terrace", way: "way", cir: "circle", circle: "circle",
};

type StreetName = { core: string; direction?: string; type?: string };
export type NamedStreet = { name: string; parts: StreetName; path: Point[] };

const isHouseNumber = (word: string) => /^\d+[a-z]?$/.test(word);

// "1182 E. Mariposa St, Altadena" and "East Mariposa Street" both come out as mariposa, east, street.
export function parseStreetName(text: string): StreetName {
  const words = (text.split(",")[0] ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word && !isHouseNumber(word));
  const direction = words.map((word) => DIRECTION_WORDS[word]).find(Boolean);
  const type = words.map((word) => STREET_TYPES[word]).find(Boolean);
  const core = words.filter((word) => !DIRECTION_WORDS[word] && !STREET_TYPES[word]).join(" ");
  return { core, direction, type };
}

export function namedStreets(data: InkMapData): NamedStreet[] {
  return data.roads.filter((road) => road.name).map((road) => ({ name: road.name, parts: parseStreetName(road.name), path: road.path }));
}

// Keeps only the candidates that agree, unless none do: a typed "St" shouldn't hide the Avenue.
function narrow(streets: NamedStreet[], wanted: string | undefined, part: (street: NamedStreet) => string | undefined) {
  if (!wanted) return streets;
  const agreeing = streets.filter((street) => part(street) === wanted);
  return agreeing.length > 0 ? agreeing : streets;
}

function matchStreet(streets: NamedStreet[], address: string) {
  const typed = parseStreetName(address);
  if (typed.core.length < MIN_NAME_LENGTH) return [];
  const sameName = streets.filter((street) => street.parts.core === typed.core);
  const byDirection = narrow(sameName, typed.direction, (street) => street.parts.direction);
  return narrow(byDirection, typed.type, (street) => street.parts.type);
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

// The point of a street nearest its middle, so a long street opens on the stretch most of it is near.
function middleOf(points: Point[]): Point {
  const centre: Point = [median(points.map(([x]) => x)), median(points.map(([, y]) => y))];
  return points.reduce((best, point) => (Math.hypot(point[0] - centre[0], point[1] - centre[1]) < Math.hypot(best[0] - centre[0], best[1] - centre[1]) ? point : best), points[0]);
}

export function residentialCentre(data: InkMapData): Point {
  const homes = data.buildings.filter((building) => building.kind === BUILDING_KIND.house);
  return [median(homes.map((home) => home.center[0])), median(homes.map((home) => home.center[1]))];
}

function frameAround([x, y]: Point): Frame {
  const half = STREET_SCALE_METERS / 2;
  return { x0: Math.round(x - half), y0: Math.round(y - half), x1: Math.round(x + half), y1: Math.round(y + half) };
}

// Where the map opens: on the street the person typed when the map knows it, otherwise on the
// fallback point. Either way at street scale.
export function homeFrame(streets: NamedStreet[], address: string, fallback: Point): { frame: Frame; street: string | null } {
  const matches = matchStreet(streets, address);
  if (matches.length === 0) return { frame: frameAround(fallback), street: null };
  const middle = middleOf(matches.flatMap((street) => street.path));
  const street = matches.find((candidate) => candidate.path.includes(middle)) ?? matches[0];
  return { frame: frameAround(middle), street: street.name };
}
