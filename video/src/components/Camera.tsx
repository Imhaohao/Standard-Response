import { createContext, ReactNode, useContext } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { XY } from "../data/scene";
import { ease, HEIGHT, WIDTH } from "../theme";

export type Shot = { frame: number; focus: XY; zoom: number };

const ZoomContext = createContext(1);

// Strokes and marks divide by this so they keep their screen size while the camera moves.
export const useZoom = () => useContext(ZoomContext);

function cameraAt(frame: number, shots: Shot[]) {
  const frames = shots.map((shot) => shot.frame);
  const options = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.inOut } as const;
  const zoom = Math.exp(interpolate(frame, frames, shots.map((shot) => Math.log(shot.zoom)), options));
  // Keep the frame on the plate: past its edge there is no map to show.
  const clamp = (value: number, half: number, size: number) => Math.min(size - half / zoom, Math.max(half / zoom, value));
  return {
    x: clamp(interpolate(frame, frames, shots.map((shot) => shot.focus[0]), options), WIDTH / 2, WIDTH),
    y: clamp(interpolate(frame, frames, shots.map((shot) => shot.focus[1]), options), HEIGHT / 2, HEIGHT),
    zoom,
  };
}

export function Camera({ shots, shake = [0, 0], children }: { shots: Shot[]; shake?: XY; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { x, y, zoom } = cameraAt(frame, shots);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          width: WIDTH,
          height: HEIGHT,
          transformOrigin: "0 0",
          transform: `translate(${WIDTH / 2 - x * zoom + shake[0]}px, ${HEIGHT / 2 - y * zoom + shake[1]}px) scale(${zoom})`,
        }}
      >
        <ZoomContext.Provider value={zoom}>{children}</ZoomContext.Provider>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// An SVG layer in map space: the same 1920x1080 grid the plate was captured on.
export function MapLayer({ children, opacity = 1 }: { children: ReactNode; opacity?: number }) {
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ position: "absolute", inset: 0, overflow: "visible", opacity }}>
      {children}
    </svg>
  );
}
