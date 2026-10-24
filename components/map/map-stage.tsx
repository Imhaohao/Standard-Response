"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { InkMapHandle } from "@/components/ink-map/ink-map-canvas";
import { LatLng } from "@/lib/geo";
import { InkMapView } from "@/lib/ink-map/camera";
import { createProjection, InkMapData, Point } from "@/lib/ink-map/data";
import { Hazard } from "@/lib/ink-map/hazard";
import { BuildingState } from "@/lib/ink-map/renderer";
import { InkSurface } from "./ink-surface";
import { PaperSurface } from "./paper-surface";
import { closeupFrame, fitFrame, Frame, PAPER_FIT, Size, unframe } from "./projection";

export type SurfaceMode = "ink" | "paper";
export type ScreenPoint = { x: number; y: number; visible: boolean };

type StageValue = {
  data: InkMapData;
  size: Size;
  version: number;
  project: (point: Point) => ScreenPoint;
  toScreen: (point: LatLng) => ScreenPoint;
  toLocal: (point: LatLng) => Point;
  toLatLng: (point: Point) => LatLng;
};

const StageContext = createContext<StageValue | null>(null);

export function useMapStage() {
  const stage = useContext(StageContext);
  if (!stage) throw new Error("useMapStage must be used inside MapStage");
  return stage;
}

// The flat map draws a rectangle of ground; the 3D camera shows a bit more than the rectangle it
// was asked to fit, so the flat frame is widened to hold roughly the same streets.
function frameEdges(view: InkMapView): [number, number, number, number] {
  if (view.kind === "overview") return [view.fit.x0, view.fit.y0, view.fit.x1, view.fit.y1];
  const frame = closeupFrame(view.center, view.radius * 2.6);
  return [frame.x0, frame.y0, frame.x1, frame.y1];
}

const HIDDEN: ScreenPoint = { x: 0, y: 0, visible: false };

export function MapStage({
  data,
  view,
  mode = "ink",
  hazard,
  minutes,
  fronts,
  highlights,
  onPick,
  interactive = false,
  children,
  className = "",
}: {
  data: InkMapData;
  view: InkMapView;
  mode?: SurfaceMode;
  hazard?: Hazard | null;
  minutes?: number;
  fronts?: { minutes: number; ring: Point[] }[];
  highlights?: Map<number, BuildingState>;
  onPick?: (point: Point) => void;
  interactive?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [handle, setHandle] = useState<InkMapHandle | null>(null);
  const [x0, y0, x1, y1] = frameEdges(view);
  const frame = useMemo<Frame>(() => ({ x0, y0, x1, y1 }), [x0, y0, x1, y1]);
  const projection = useMemo(() => createProjection(data.origin), [data.origin]);
  const { toLatLng, toLocal } = projection;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width >= 2 && height >= 2) setSize({ width, height });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const click = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onPick || !size) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const ground = mode === "paper" ? unframe(frame, size, x, y, PAPER_FIT) : handle?.renderer.pickGround(x, y) ?? null;
      if (ground) onPick(ground);
    },
    [onPick, size, mode, frame, handle],
  );

  // Markers are projected from the live camera on the 3D surface, and from the flat frame on the
  // 2D one. Until the canvas has a size there is nothing to project into.
  const value = useMemo<StageValue | null>(() => {
    if (!size) return null;
    const renderer = handle?.renderer;
    const project = mode === "paper" ? fitFrame(frame, size, PAPER_FIT) : renderer ? (point: Point) => renderer.project(point) : () => HIDDEN;
    return { data, size, version: handle?.version ?? 0, project, toScreen: (point) => project(toLocal(point)), toLocal, toLatLng };
  }, [data, size, handle, mode, frame, toLocal, toLatLng]);

  return (
    <div
      ref={boxRef}
      onClick={onPick ? click : undefined}
      className={`relative isolate size-full overflow-hidden bg-canvas ${interactive ? "cursor-crosshair" : ""} ${className}`}
    >
      {mode === "ink" ? (
        <InkSurface data={data} view={view} hazard={hazard ?? null} minutes={minutes ?? 0} highlights={highlights ?? EMPTY} onHandle={setHandle} />
      ) : (
        size && (
          <svg width={size.width} height={size.height} className="absolute inset-0" role="img" aria-label="Flat map of Altadena: streets, hills and the fire front">
            <PaperSurface data={data} frame={frame} size={size} fronts={fronts ?? []} minutes={minutes ?? 0} />
          </svg>
        )
      )}
      {value && (
        <StageContext.Provider value={value}>
          <svg width={value.size.width} height={value.size.height} className="pointer-events-none absolute inset-0" aria-hidden>
            {children}
          </svg>
        </StageContext.Provider>
      )}
    </div>
  );
}

const EMPTY: Map<number, BuildingState> = new Map();
