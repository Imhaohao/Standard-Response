import { AREA } from "@/convex/model";

export const MAP_WIDTH = 520;
export const MAP_HEIGHT = 495;
export const METERS_PER_PX = 2575 / MAP_WIDTH;

export type LatLng = { lat: number; lng: number };

export function project({ lat, lng }: LatLng) {
  return {
    x: ((lng - AREA.west) / (AREA.east - AREA.west)) * MAP_WIDTH,
    y: ((AREA.north - lat) / (AREA.north - AREA.south)) * MAP_HEIGHT,
  };
}

export function unproject(x: number, y: number): LatLng {
  return {
    lat: AREA.north - (y / MAP_HEIGHT) * (AREA.north - AREA.south),
    lng: AREA.west + (x / MAP_WIDTH) * (AREA.east - AREA.west),
  };
}

export const pointsAttribute = (path: LatLng[]) =>
  path.map((p) => project(p)).map(({ x, y }) => `${x},${y}`).join(" ");
