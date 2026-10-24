import { NEVER_BURNS, ScenarioGeoJson, scenarioFronts, arrivalAt } from "../ink-map/fire-field";
import { featuresOf } from "./federated";
import { metersBetween } from "../../convex/model";
import { nearbyBlockedShare, SEGMENT_LIST } from "./roads";

// The model's features for one street, computed the same way on a phone, at the agency and in the
// simulation: the fire scenario in the warning, the road itself, the clock, and what the one
// computing it believes is blocked nearby.

// Minutes after the warning when the scenario fire reaches each segment's midpoint.
export function segmentFireMinutes(scenario: ScenarioGeoJson | null): Float64Array {
  const out = new Float64Array(SEGMENT_LIST.length).fill(NEVER_BURNS);
  if (!scenario?.features?.length) return out;
  const origin = SEGMENT_LIST[0].mid;
  const toLocal = (p: { lat: number; lng: number }): [number, number] => [
    Math.sign(p.lng - origin.lng) * metersBetween(origin, { lat: origin.lat, lng: p.lng }),
    Math.sign(p.lat - origin.lat) * metersBetween(origin, { lat: p.lat, lng: origin.lng }),
  ];
  const fronts = scenarioFronts(scenario, toLocal);
  SEGMENT_LIST.forEach((segment, i) => {
    const [x, y] = toLocal(segment.mid);
    out[i] = arrivalAt(fronts, x, y);
  });
  return out;
}

export function streetFeatures(segment: number, minutesSinceWarning: number, fireMinutes: Float64Array, believedBlocked: (segment: number) => boolean) {
  const arrival = fireMinutes[segment];
  return featuresOf({
    minutesToFire: arrival >= NEVER_BURNS ? NEVER_BURNS : arrival - minutesSinceWarning,
    kph: SEGMENT_LIST[segment].kph,
    lanes: SEGMENT_LIST[segment].lanes,
    minutesSinceWarning,
    nearbyBlockedShare: nearbyBlockedShare(segment, believedBlocked),
  });
}
