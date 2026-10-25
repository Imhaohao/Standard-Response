import * as THREE from "three";
import type { InkMapData, Point } from "../data";
import { arrivalMinutesAt, NEVER_BURNS, type FireField } from "../fire-field";
import type { HazardImpact } from "./types";

// Minutes past its latest burning neighbour that a cell the hazard never reaches is given in the
// texture. See edgeBlended.
const PAST_THE_EDGE_MINUTES = 10;

// A cell the hazard never reaches holds NEVER_BURNS, and the texture's blend from a reached cell's
// few hundred minutes up to ten thousand crosses any clock minute right beside the reached cell, so
// the edge comes out in the grid's stair steps. Each unreached cell beside a reached one instead
// holds a little past its latest reached neighbour: still past the hazard's last minute, so it still
// reads as never reached, but the blend now crosses the edge partway between cells and the edge runs
// smoothly across the grid.
function edgeBlended(field: FireField) {
  const { width, height, minutes } = field;
  const out = Float32Array.from(minutes);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (minutes[row * width + col] < NEVER_BURNS) continue;
      const latest = latestReachedNeighbour(field, col, row);
      if (latest !== null) out[row * width + col] = latest + PAST_THE_EDGE_MINUTES;
    }
  }
  return out;
}

function latestReachedNeighbour({ width, height, minutes }: FireField, col: number, row: number) {
  let latest: number | null = null;
  for (let r = Math.max(0, row - 1); r <= Math.min(height - 1, row + 1); r++) {
    for (let c = Math.max(0, col - 1); c <= Math.min(width - 1, col + 1); c++) {
      const value = minutes[r * width + c];
      if (value < NEVER_BURNS) latest = Math.max(latest ?? value, value);
    }
  }
  return latest;
}

// The arrival field as a half-float texture over its region, for a shader's arrivalMinutes(mapXY)
// (glsl.ts ARRIVAL_GLSL). Set these three uniforms from it: tArrival, uArrivalRegion, uArrivalLast.
export function arrivalTexture(field: FireField) {
  const minutes = edgeBlended(field);
  const half = new Uint16Array(minutes.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(minutes[i]);
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
