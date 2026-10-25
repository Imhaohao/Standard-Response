import type { InkMapData, Point } from "../../data";
import { arrivalMinutesAt, type FireField } from "../../fire-field";
import type { ArrivalIndex } from "../arrival";
import { BUILDING_FLOODED_DEPTH, depthAt, groundAt, ROAD_CLOSED_DEPTH, type WaterModel } from "./model";

// When the water first stands deep enough at each building and on each road to count: a building once
// water is over its floor, a road once a car can't drive through it. Reached stays reached, the way the
// fire's index works, so a tsunami's roads stay closed after the water drains off them.

const NEVER = Infinity;
// A road is checked every this many metres along its line, so a long straight block can't step over a dip.
const ROAD_CHECK_SPACING = 20;

const stepMinutes = (model: WaterModel) => (model.kind === "tsunami" ? 0.5 : 1);

export function clockSteps(model: WaterModel) {
  const steps: number[] = [];
  const step = stepMinutes(model);
  for (let minutes = model.span.from; minutes <= model.span.to; minutes += step) steps.push(minutes);
  return steps;
}

// The first minute the water stands at least `depth` deep at a point, or Infinity if it never does.
export function firstUnderWater(model: WaterModel, data: InkMapData, field: FireField, point: Point, depth: number, steps: number[]) {
  const arrival = arrivalMinutesAt(field, point);
  if (arrival === null) return NEVER;
  const ground = groundAt(data, point);
  if (depthAt(model, ground, arrival, point, arrival) >= depth) return arrival;
  const later = steps.find((minutes) => minutes > arrival && depthAt(model, ground, arrival, point, minutes) >= depth);
  return later ?? NEVER;
}

export function alongLine(path: Point[], spacing = ROAD_CHECK_SPACING): Point[] {
  const points: Point[] = path.slice(0, 1);
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / spacing));
    for (let k = 1; k <= pieces; k++) points.push([ax + ((bx - ax) * k) / pieces, ay + ((by - ay) * k) / pieces]);
  }
  return points;
}

// The minute a whole line is first cut: the soonest any point along it goes under.
function firstCut(model: WaterModel, data: InkMapData, field: FireField, path: Point[], steps: number[]) {
  return alongLine(path).reduce((first, point) => Math.min(first, firstUnderWater(model, data, field, point, ROAD_CLOSED_DEPTH, steps)), NEVER);
}

// The same shape as the fire's arrival index, so arrival.ts's impactAt answers any minute from it.
export function waterIndex(model: WaterModel, data: InkMapData, field: FireField): ArrivalIndex {
  const steps = clockSteps(model);
  return {
    buildings: data.buildings.map((building) => firstUnderWater(model, data, field, building.center, BUILDING_FLOODED_DEPTH, steps)),
    roads: data.roads.map((road) => firstCut(model, data, field, road.path, steps)),
    edges: data.graph.edges.map((edge) => ({ key: edge.key, minutes: firstCut(model, data, field, edge.shape, steps) })),
  };
}
