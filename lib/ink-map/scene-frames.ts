import type { City, CityFrame, LocalFrame } from "../cities";
import type { InkMapView } from "./camera";
import { createProjection, type Point } from "./data";

// The overview camera looks down at 47 degrees, so ground running away from it shows at about
// sin(47°) of its length on screen. Used to guess how much ground a screen shape holds.
const FORESHORTENING = Math.sin((47 * Math.PI) / 180);

const clampCentre = (centre: number, half: number, lo: number, hi: number) => Math.min(Math.max(centre, lo + half), hi - half);

// Trims a fit to the screen's shape so the overview fills a phone held upright as well as a wide
// screen, keeping `focus` as near the middle as the fit allows.
export function fillFit(fit: LocalFrame, aspect: number, focus?: Point): LocalFrame {
  const width = fit.x1 - fit.x0;
  const depth = fit.y1 - fit.y0;
  const [fx, fy] = focus ?? [(fit.x0 + fit.x1) / 2, (fit.y0 + fit.y1) / 2];
  if (aspect < width / (depth * FORESHORTENING)) {
    const half = Math.min(width, aspect * depth * FORESHORTENING) / 2;
    const cx = clampCentre(fx, half, fit.x0, fit.x1);
    return { x0: cx - half, y0: fit.y0, x1: cx + half, y1: fit.y1 };
  }
  const half = Math.min(depth, width / (aspect * FORESHORTENING)) / 2;
  const cy = clampCentre(fy, half, fit.y0, fit.y1);
  return { x0: fit.x0, y0: cy - half, x1: fit.x1, y1: cy + half };
}

export function frameByName(city: City, name: string | null | undefined): CityFrame {
  return city.frames.find((frame) => frame.name === name) ?? city.frames[0];
}

// The fixed camera for one of a city's named frames on a screen of this shape.
export function cityView(city: City, frame: CityFrame, aspect: number): InkMapView {
  const { toLocal } = createProjection(city.origin);
  if (frame.kind === "closeup") return { kind: "closeup", center: toLocal(frame.center), radius: frame.radius };
  return { kind: "overview", fit: fillFit(frame.fit, aspect, frame.focus && toLocal(frame.focus)) };
}
