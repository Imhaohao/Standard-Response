import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";

// A frame is a rectangle in the map's own metres: x east, y north. Both surfaces share one.
export type Frame = { x0: number; y0: number; x1: number; y1: number };
export type Size = { width: number; height: number };
export type LocalProjection = (point: Point) => { x: number; y: number; visible: boolean };

const MARGIN = 0.96;

// "contain" fits the whole frame in the box, as the 3D camera frames an overview; "cover" fills
// the box and lets the frame run off the edges, as it frames a close-up.
export type Fit = "contain" | "cover";

// The ground a box shows when a frame is fitted into it, centred, with a little margin: the frame
// widened (contain) or trimmed (cover) to the box's proportions. The flat view draws, picks and
// places markers over this rectangle, so its streets reach every edge of the box.
export function boxFrame(frame: Frame, size: Size, fit: Fit): Frame {
  const across = size.width / (frame.x1 - frame.x0);
  const down = size.height / (frame.y1 - frame.y0);
  const scale = (fit === "cover" ? Math.max(across, down) : Math.min(across, down)) * MARGIN;
  const halfWidth = size.width / scale / 2;
  const halfHeight = size.height / scale / 2;
  const cx = (frame.x0 + frame.x1) / 2;
  const cy = (frame.y0 + frame.y1) / 2;
  return { x0: cx - halfWidth, y0: cy - halfHeight, x1: cx + halfWidth, y1: cy + halfHeight };
}

// Maps a frame into a box in CSS pixels, centred, keeping the map's proportions; a frame from
// boxFrame fills the box exactly. Screen y grows down while map y grows north, so the flip happens
// here and nowhere else.
export function frameTransform(frame: Frame, size: Size) {
  const scale = Math.min(size.width / (frame.x1 - frame.x0), size.height / (frame.y1 - frame.y0));
  return {
    scale,
    offsetX: (size.width - (frame.x1 - frame.x0) * scale) / 2,
    offsetY: (size.height - (frame.y1 - frame.y0) * scale) / 2,
  };
}

export function fitFrame(frame: Frame, size: Size): LocalProjection {
  const { scale, offsetX, offsetY } = frameTransform(frame, size);
  return ([x, y]) => ({
    x: offsetX + (x - frame.x0) * scale,
    y: offsetY + (frame.y1 - y) * scale,
    visible: x >= frame.x0 && x <= frame.x1 && y >= frame.y0 && y <= frame.y1,
  });
}

export function unframe(frame: Frame, size: Size, screenX: number, screenY: number): Point {
  const { scale, offsetX, offsetY } = frameTransform(frame, size);
  return [frame.x0 + (screenX - offsetX) / scale, frame.y1 - (screenY - offsetY) / scale];
}

export const projectLatLng =
  (toLocal: (p: LatLng) => Point, project: LocalProjection) =>
  (point: LatLng) =>
    project(toLocal(point));

// The overview frame: the town, its foothills, and the ground the scenario fire comes from.
export const TOWN_FRAME: Frame = { x0: -1700, y0: -1550, x1: 3700, y1: 2800 };

export function closeupFrame(center: Point, radius: number): Frame {
  return { x0: center[0] - radius, y0: center[1] - radius, x1: center[0] + radius, y1: center[1] + radius };
}
