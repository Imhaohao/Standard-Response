import * as THREE from "three";
import type { InkMapData, Point } from "../data";
import { arrivalMinutesAt, type FireField } from "../fire-field";
import type { HazardImpact } from "./types";

// The arrival field as a half-float texture over its region, for a shader's arrivalMinutes(mapXY)
// (glsl.ts ARRIVAL_GLSL). Set these three uniforms from it: tArrival, uArrivalRegion, uArrivalLast.
export function arrivalTexture(field: FireField) {
  const half = new Uint16Array(field.minutes.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(field.minutes[i]);
  const texture = new THREE.DataTexture(half, field.width, field.height, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return {
    texture,
    region: new THREE.Vector4(field.region.x0, field.region.y0, field.region.x1, field.region.y1),
    last: field.fronts[field.fronts.length - 1].minutes,
  };
}

const NEVER = Infinity;

const firstReached = (field: FireField, points: Point[]) =>
  points.reduce((first, point) => Math.min(first, arrivalMinutesAt(field, point) ?? NEVER), NEVER);

// The minute the hazard first reaches each building's centre, each road and each graph edge.
// Computed once per field; impactAt answers any minute from it.
export function arrivalIndex(data: InkMapData, field: FireField) {
  return {
    buildings: data.buildings.map((building) => arrivalMinutesAt(field, building.center) ?? NEVER),
    roads: data.roads.map((road) => firstReached(field, road.path)),
    edges: data.graph.edges.map((edge) => ({ key: edge.key, minutes: firstReached(field, edge.shape) })),
  };
}

export type ArrivalIndex = ReturnType<typeof arrivalIndex>;

const reachedBy = (arrivals: number[], minutes: number) => arrivals.flatMap((arrival, index) => (arrival <= minutes ? [index] : []));

export function impactAt(index: ArrivalIndex, minutes: number): HazardImpact {
  return {
    buildings: reachedBy(index.buildings, minutes),
    roads: reachedBy(index.roads, minutes),
    edges: index.edges.filter((edge) => edge.minutes <= minutes).map((edge) => edge.key),
  };
}

export const NO_IMPACT: HazardImpact = { buildings: [], roads: [], edges: [] };
