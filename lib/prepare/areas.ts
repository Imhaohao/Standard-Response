// The areas the county sees counts for: the 28 census block groups of west Altadena that the
// synthetic population lives in (data/census/blockgroups.geojson, ACS 2019-2023). A block group is
// a few hundred households, the smallest unit the census itself publishes counts for, so a count
// at this grain says nothing the census doesn't already say about how many people live there.
//
// The phone finds its block group from a home pin on its own map. The pin never leaves the phone;
// only the block group's position in this list goes into the household's counts.

export const AREA_IDS = [
  "060374602001",
  "060374602002",
  "060374602003",
  "060374602004",
  "060374602005",
  "060374603011",
  "060374603012",
  "060374603013",
  "060374603014",
  "060374603021",
  "060374603022",
  "060374603023",
  "060374603024",
  "060374605013",
  "060374609001",
  "060374609003",
  "060374609004",
  "060374610001",
  "060374610002",
  "060374610003",
  "060374610004",
  "060374611001",
  "060374611002",
  "060374611003",
  "060374611004",
  "060374615011",
  "060374615021",
  "060374615022",
] as const;

// The same shape as lib/geo.ts's, which convex/ can't import (it uses @/ paths).
export type LatLng = { lat: number; lng: number };

export const AREA_COUNT = AREA_IDS.length;
export const AREA_INDEX = new Map<string, number>(AREA_IDS.map((id, i) => [id, i]));

// "Block group 4603.02-2": census tract 4603.02, block group 2.
// "4602.01-2": the census tract and the block group within it.
export function blockGroupNumber(geoid: string) {
  const tract = geoid.slice(5, 11);
  return `${Number(tract.slice(0, 4))}.${tract.slice(4)}-${geoid.slice(11)}`;
}

export function areaLabel(geoid: string) {
  return `Block group ${blockGroupNumber(geoid)}`;
}

export type AreaShape = { id: string; households: number; rings: LatLng[][] };

type Feature = { properties?: { GEOID?: unknown; households?: unknown }; geometry?: { type?: string; coordinates?: unknown } };

// Our block groups out of the census GeoJSON, as rings of { lat, lng }.
export function areaShapes(geojson: { features?: Feature[] }): AreaShape[] {
  const shapes: AreaShape[] = [];
  for (const feature of geojson.features ?? []) {
    const id = String(feature.properties?.GEOID ?? "");
    if (!AREA_INDEX.has(id) || !feature.geometry) continue;
    const { type, coordinates } = feature.geometry;
    const polygons = (type === "Polygon" ? [coordinates] : type === "MultiPolygon" ? coordinates : []) as number[][][][];
    const rings = polygons.flatMap((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))));
    shapes.push({ id, households: Number(feature.properties?.households ?? 0), rings });
  }
  return shapes.sort((a, b) => AREA_INDEX.get(a.id)! - AREA_INDEX.get(b.id)!);
}

// Even-odd rule over every ring, so holes count as outside.
function inside(point: LatLng, rings: LatLng[][]) {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.lat > point.lat !== b.lat > point.lat && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) odd = !odd;
    }
  }
  return odd;
}

export function areaOf(point: LatLng, shapes: AreaShape[]): string | null {
  return shapes.find((shape) => inside(point, shape.rings))?.id ?? null;
}
