"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { InkMapHandle } from "@/components/ink-map/ink-map-canvas";
import { LatLng } from "@/lib/geo";
import { InkMapView } from "@/lib/ink-map/camera";
import { createProjection, InkMapData, Point } from "@/lib/ink-map/data";
import { Hazard } from "@/lib/ink-map/hazard";
import { BuildingState, InkMapRenderer } from "@/lib/ink-map/renderer";
import { InkSurface } from "./ink-surface";
import { PaperSurface } from "./paper-surface";
import { SmokeLayer } from "./smoke-layer";
import { closeupFrame, fitFrame, Frame, PAPER_FIT, Size, unframe } from "./projection";
import { useMapGestures } from "./use-map-gestures";

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
  zoomBy: (factor: number) => void;
  resetView: () => void;
  zoomed: boolean;
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
  mode: requestedMode = "ink",
  hazard,
  minutes,
  fronts,
  highlights,
  onPick,
  onContextPick,
  focus,
  interactive = false,
  children,
  controls,
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
  onContextPick?: (point: Point, screen: { x: number; y: number }) => void;
  focus?: FlyTarget | null;
  interactive?: boolean;
  children?: ReactNode;
  controls?: ReactNode;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(boxRef);
  const [handle, setHandle] = useState<InkMapHandle | null>(null);
  const [inkFailed, setInkFailed] = useState(false);
  const fail = useCallback(() => setInkFailed(true), []);
  const mode: SurfaceMode = inkFailed ? "paper" : requestedMode;
  const [x0, y0, x1, y1] = frameEdges(view);
  const frame = useMemo<Frame>(() => ({ x0, y0, x1, y1 }), [x0, y0, x1, y1]);
  const projection = useMemo(() => createProjection(data.origin), [data.origin]);
  const { toLatLng, toLocal } = projection;


  const renderer = mode === "ink" ? handle?.renderer ?? null : null;
  const dragged = useMapGestures(boxRef, renderer);
  useFlyTo(renderer, focus);

  const groundAt = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!size) return null;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const ground = mode === "paper" ? unframe(frame, size, x, y, PAPER_FIT) : handle?.renderer.pickGround(x, y) ?? null;
      return ground ? { ground, screen: { x, y } } : null;
    },
    [size, mode, frame, handle],
  );

  const click = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onPick || dragged.current) return;
      const hit = groundAt(event);
      if (hit) onPick(hit.ground);
    },
    [onPick, groundAt, dragged],
  );

  const contextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onContextPick) return;
      event.preventDefault();
      const hit = groundAt(event);
      if (hit) onContextPick(hit.ground, hit.screen);
    },
    [onContextPick, groundAt],
  );

  // Markers are projected from the live camera on the 3D surface, and from the flat frame on the
  // 2D one. Until the canvas has a size there is nothing to project into.
  const value = useMemo(
    () => (size ? stageValue({ data, size, handle, mode, frame, toLocal, toLatLng }) : null),
    [data, size, handle, mode, frame, toLocal, toLatLng],
  );

  return (
    <div
      ref={boxRef}
      onClick={onPick ? click : undefined}
      onContextMenu={onContextPick ? contextMenu : undefined}
      className={`relative isolate size-full touch-none overflow-hidden bg-canvas ${cursorFor(interactive, mode)} ${className}`}
    >
      <StageSurface mode={mode} data={data} view={view} frame={frame} size={size} hazard={hazard} minutes={minutes} fronts={fronts} highlights={highlights} onHandle={setHandle} onFail={fail} />
      {value && (
        <StageContext.Provider value={value}>
          <svg width={value.size.width} height={value.size.height} className="pointer-events-none absolute inset-0" aria-hidden>
            {mode === "ink" && hazard && <SmokeLayer fronts={hazard.field.fronts} minutes={minutes ?? 0} />}
            {children}
          </svg>
          {controls}
        </StageContext.Provider>
      )}
    </div>
  );
}

const EMPTY: Map<number, BuildingState> = new Map();

type SurfaceProps = {
  mode: SurfaceMode;
  data: InkMapData;
  view: InkMapView;
  frame: Frame;
  size: Size | null;
  hazard?: Hazard | null;
  minutes?: number;
  fronts?: { minutes: number; ring: Point[] }[];
  highlights?: Map<number, BuildingState>;
  onHandle: (handle: InkMapHandle | null) => void;
  onFail: () => void;
};

function StageSurface({ mode, data, view, frame, size, hazard, minutes = 0, fronts = [], highlights = EMPTY, onHandle, onFail }: SurfaceProps) {
  if (mode === "ink") {
    return <InkSurface data={data} view={view} hazard={hazard ?? null} minutes={minutes} highlights={highlights} onHandle={onHandle} onFail={onFail} />;
  }
  if (!size) return null;
  return (
    <svg width={size.width} height={size.height} className="absolute inset-0" role="img" aria-label="Flat map of Altadena: streets, hills and the fire front">
      <PaperSurface data={data} frame={frame} size={size} fronts={fronts} minutes={minutes} />
    </svg>
  );
}

// A place to glide to. The key lets the same spot be asked for twice in a row.
export type FlyTarget = { point: Point; key: string };
const FLY_ZOOM = 4;

function useFlyTo(renderer: InkMapRenderer | null, target: FlyTarget | null | undefined) {
  const key = target?.key;
  const point = target?.point;
  useEffect(() => {
    if (renderer && point) renderer.flyTo(point, FLY_ZOOM);
    // Only a new target moves the map; the same person's point object changing must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, key]);
}

function useElementSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width >= 2 && height >= 2) setSize({ width, height });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function cursorFor(drawing: boolean, mode: SurfaceMode) {
  if (drawing) return "cursor-crosshair";
  return mode === "ink" ? "cursor-grab active:cursor-grabbing" : "";
}

type StageInputs = {
  data: InkMapData;
  size: Size;
  handle: InkMapHandle | null;
  mode: SurfaceMode;
  frame: Frame;
  toLocal: (point: LatLng) => Point;
  toLatLng: (point: Point) => LatLng;
};

function stageValue({ data, size, handle, mode, frame, toLocal, toLatLng }: StageInputs): StageValue {
  const ink = mode === "ink" ? handle?.renderer : undefined;
  const flat = fitFrame(frame, size, PAPER_FIT);
  const project = mode === "paper" ? flat : ink ? (point: Point) => ink.project(point) : () => HIDDEN;
  return {
    data,
    size,
    version: handle?.version ?? 0,
    project,
    toScreen: (point) => project(toLocal(point)),
    toLocal,
    toLatLng,
    zoomBy: (factor) => ink?.zoomAt(factor, size.width / 2, size.height / 2),
    resetView: () => ink?.resetView(),
    zoomed: (ink?.zoom ?? 1) > 1.01,
  };
}
