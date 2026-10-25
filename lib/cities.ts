import type { LatLng } from "./geo";

// Every place the evacuation pipeline can be shown in, with the disaster it is shown against.
// The browser reads this file, and so do the map scripts: `node scripts/map/fetch.mjs --city <id>`
// imports it directly (Node strips the types), so it holds plain data and type-only imports.

export const HAZARD_KINDS = ["wildfire", "flood", "surge", "tsunami", "blizzard"] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

// A box in degrees, as Overpass and the terrain tiles take it.
export type GeoBox = { south: number; west: number; north: number; east: number };
// A rectangle in the map's own metres east and north of the city's origin, as the camera takes it.
export type LocalFrame = { x0: number; y0: number; x1: number; y1: number };

// A fixed camera: the whole overview, or a close-up on one place. The scenes page lists them by name.
// An overview fills any screen shape by trimming its fit, keeping `focus` (the fit's centre if unset) in view.
export type CityFrame = { name: string; label: string } & ({ kind: "overview"; fit: LocalFrame; focus?: LatLng } | { kind: "closeup"; center: LatLng; radius: number });

export type Source = { label: string; url?: string };

export type City = {
  id: string;
  name: string;
  event: { name: string; date: string; kind: HazardKind };
  // Every baked coordinate is metres east and north of this point.
  origin: LatLng;
  // The town the camera frames and keeps to.
  detail: GeoBox;
  // The wider ground buildings, streets and trees are baked over.
  extent: GeoBox;
  // The terrain grid's reach, wider again so hills or open water close off the frame.
  terrain: GeoBox;
  terrainZoom: number;
  terrainCellMeters: number;
  // The Overpass `date:` the buildings are baked from: just before the event, so the town stands as it was.
  // Null bakes today's map, and the scenario's `basis` says so.
  osmSnapshot: string | null;
  frames: CityFrame[];
  // Where the loader fetches the bake from.
  files: { map: string; terrain: string };
  sources: Source[];
};

const METERS_PER_DEG_LAT = 110_574;

// The same flat projection lib/ink-map/data.ts uses, so a frame given in degrees lands on the bake.
export function localFrame(origin: LatLng, box: GeoBox): LocalFrame {
  const metersPerDegLng = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  return {
    x0: Math.round((box.west - origin.lng) * metersPerDegLng),
    y0: Math.round((box.south - origin.lat) * METERS_PER_DEG_LAT),
    x1: Math.round((box.east - origin.lng) * metersPerDegLng),
    y1: Math.round((box.north - origin.lat) * METERS_PER_DEG_LAT),
  };
}

const bakedFiles = (id: string) => ({ map: `/map/cities/${id}.json`, terrain: `/map/cities/${id}-terrain.bin` });

const OSM: Source = { label: "OpenStreetMap contributors (ODbL)", url: "https://www.openstreetmap.org/copyright" };
const TERRAIN_TILES: Source = { label: "Terrain Tiles on AWS (Mapzen terrarium, USGS 3DEP)", url: "https://registry.opendata.aws/terrain-tiles/" };

// Altadena's values are the bake in public/map as committed; scripts/map/frame.mjs still holds the
// copy the default bake reads, so change both together.
const ALTADENA: City = {
  id: "altadena",
  name: "Altadena",
  event: { name: "Eaton Fire", date: "2025-01-07", kind: "wildfire" },
  origin: { lat: 34.189, lng: -118.154 },
  detail: { south: 34.17, north: 34.216, west: -118.178, east: -118.108 },
  extent: { south: 34.148, north: 34.232, west: -118.205, east: -118.08 },
  terrain: { south: 34.125, north: 34.275, west: -118.225, east: -118.065 },
  terrainZoom: 14,
  terrainCellMeters: 15,
  osmSnapshot: "2024-12-15T00:00:00Z",
  frames: [
    { name: "overview", label: "Altadena", kind: "overview", fit: { x0: -1700, y0: -1550, x1: 3700, y1: 2800 } },
    { name: "west", label: "West Altadena", kind: "closeup", center: { lat: 34.1925, lng: -118.1585 }, radius: 420 },
    { name: "foothills", label: "The foothills", kind: "closeup", center: { lat: 34.2035, lng: -118.135 }, radius: 480 },
  ],
  files: { map: "/map/altadena.json", terrain: "/map/terrain.bin" },
  sources: [OSM, TERRAIN_TILES, { label: "CAL FIRE Eaton Fire incident", url: "https://www.fire.ca.gov/incidents/2025/1/7/eaton-fire" }],
};

// The other five. `verified` is true once a city's boxes have been checked against the map.
type Draft = Omit<City, "frames" | "files" | "extent" | "terrain"> & { verified: boolean; pad: { extent: number; terrain: number }; closeups: Omit<Extract<CityFrame, { kind: "closeup" }>, "kind">[] };

const grow = (box: GeoBox, degrees: number): GeoBox => ({ south: box.south - degrees, west: box.west - degrees, north: box.north + degrees, east: box.east + degrees });

function fromDraft({ verified, pad, closeups, ...city }: Draft): City & { verified: boolean } {
  return {
    ...city,
    verified,
    extent: grow(city.detail, pad.extent),
    terrain: grow(city.detail, pad.terrain),
    frames: [{ name: "overview", label: city.name, kind: "overview", fit: localFrame(city.origin, city.detail) }, ...closeups.map((closeup) => ({ ...closeup, kind: "closeup" as const }))],
    files: bakedFiles(city.id),
  };
}

// Boxes checked against OpenStreetMap on 2026-10-25: Paradise's town boundary (relation 3983857),
// the Lower Ninth Ward place node and the Inner Harbor Navigation Canal (relation 2189784), Fort
// Myers Beach's boundary (relation 1216971), and Hilo Bay (node 368391211). Each detail box also holds
// every front of its scenario in public/scenarios.
const DRAFTS: Draft[] = [
  {
    id: "paradise",
    name: "Paradise",
    event: { name: "Camp Fire", date: "2018-11-08", kind: "wildfire" },
    verified: true,
    origin: { lat: 39.77, lng: -121.61 },
    detail: { south: 39.715, north: 39.82, west: -121.68, east: -121.55 },
    pad: { extent: 0.015, terrain: 0.035 },
    terrainZoom: 14,
    terrainCellMeters: 20,
    osmSnapshot: "2018-11-07T00:00:00Z",
    closeups: [],
    sources: [OSM, TERRAIN_TILES, { label: "Scenario sources: data/cities/paradise/sources.md" }],
  },
  {
    id: "lower-ninth",
    name: "Lower Ninth Ward",
    event: { name: "Hurricane Katrina levee breach", date: "2005-08-29", kind: "flood" },
    verified: true,
    origin: { lat: 29.966, lng: -90.009 },
    detail: { south: 29.948, north: 29.984, west: -90.037, east: -89.981 },
    pad: { extent: 0.012, terrain: 0.025 },
    terrainZoom: 15,
    terrainCellMeters: 10,
    osmSnapshot: null,
    closeups: [],
    sources: [OSM, TERRAIN_TILES],
  },
  {
    id: "fort-myers-beach",
    name: "Fort Myers Beach",
    event: { name: "Hurricane Ian storm surge", date: "2022-09-28", kind: "surge" },
    verified: true,
    origin: { lat: 26.4475, lng: -81.9375 },
    detail: { south: 26.405, north: 26.49, west: -81.995, east: -81.88 },
    pad: { extent: 0.012, terrain: 0.025 },
    terrainZoom: 15,
    terrainCellMeters: 10,
    osmSnapshot: "2022-09-27T00:00:00Z",
    closeups: [],
    sources: [OSM, TERRAIN_TILES],
  },
  {
    id: "buffalo",
    name: "Buffalo East Side",
    event: { name: "Buffalo blizzard", date: "2022-12-23", kind: "blizzard" },
    verified: true,
    origin: { lat: 42.9, lng: -78.84 },
    detail: { south: 42.855, north: 42.945, west: -78.89, east: -78.79 },
    pad: { extent: 0.005, terrain: 0.02 },
    terrainZoom: 14,
    terrainCellMeters: 15,
    // The 2022-12-22 snapshot holds 9,926 buildings here and today's map 48,266; the East Side has
    // changed little since, so today's footprints stand in for the town the storm hit.
    osmSnapshot: null,
    closeups: [],
    sources: [OSM, TERRAIN_TILES, { label: "Scenario sources: data/cities/buffalo/sources.md" }],
  },
  {
    id: "hilo",
    name: "Hilo",
    event: { name: "1960 Chile tsunami", date: "1960-05-23", kind: "tsunami" },
    verified: true,
    origin: { lat: 19.724, lng: -155.08 },
    detail: { south: 19.7, north: 19.748, west: -155.11, east: -155.05 },
    pad: { extent: 0.012, terrain: 0.025 },
    terrainZoom: 15,
    terrainCellMeters: 10,
    osmSnapshot: null,
    closeups: [],
    sources: [OSM, TERRAIN_TILES],
  },
];

export const CITIES: City[] = [ALTADENA, ...DRAFTS.map(fromDraft)];

export const DEFAULT_CITY = ALTADENA.id;

export function cityById(id: string | null | undefined): City {
  return CITIES.find((city) => city.id === id) ?? ALTADENA;
}
