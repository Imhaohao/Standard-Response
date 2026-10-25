import type { Point } from "../../data";
import type { FireField } from "../../fire-field";
import type { WaterModel } from "./model";
import { cellCentre, shoreDistanceAt, type ShoreGrid } from "./shore";

// Inside its first front a scenario gives no timing, and the arrival field fills it the fire's way: the
// middle first, the edge last. Water comes from somewhere, so here it spreads out from where it comes
// in: from the breaches that are open by the first front, or else in off the standing water.

const LEAD_MINUTES = 20;

function openBreaches(model: WaterModel, first: number) {
  return (model.still?.breaches ?? []).filter((breach) => breach.opensAt <= first);
}

// Metres from where the water comes in, or null when the map shows no way in.
function sourceDistance(model: WaterModel, shore: ShoreGrid, first: number, point: Point) {
  const breaches = openBreaches(model, first);
  if (breaches.length > 0) return Math.min(...breaches.map((breach) => Math.hypot(point[0] - breach.at[0], point[1] - breach.at[1])));
  const inland = -shoreDistanceAt(shore, point);
  return Number.isFinite(inland) ? Math.max(0, inland) : null;
}

// The minute the water starts in: the first breach to open, or a little before the first front.
function startMinute(model: WaterModel, first: number) {
  const opened = openBreaches(model, first).map((breach) => breach.opensAt);
  return opened.length > 0 ? Math.min(...opened) : first - LEAD_MINUTES;
}

export function waterField(field: FireField, model: WaterModel, shore: ShoreGrid): FireField {
  const first = field.fronts[0]?.minutes;
  if (first === undefined) return field;
  const inside: { index: number; distance: number }[] = [];
  for (let index = 0; index < field.minutes.length; index++) {
    if (field.minutes[index] >= first) continue;
    const distance = sourceDistance(model, shore, first, cellCentre(field, index));
    if (distance === null) return field;
    inside.push({ index, distance });
  }
  const farthest = inside.reduce((most, cell) => Math.max(most, cell.distance), 1);
  const start = startMinute(model, first);
  const minutes = Float32Array.from(field.minutes);
  for (const { index, distance } of inside) minutes[index] = start + ((first - start) * distance) / farthest;
  return { ...field, minutes };
}
