"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { InkMapHandle } from "@/components/ink-map/ink-map-canvas";
import { LatLng } from "@/lib/geo";
import { InkMapView } from "@/lib/ink-map/camera";
import { createProjection, InkMapData, Point } from "@/lib/ink-map/data";
import { ForecastField } from "@/lib/ink-map/danger";
import { Hazard } from "@/lib/ink-map/hazard";
import { BuildingState, InkMapRenderer } from "@/lib/ink-map/renderer";
import { InkSurface } from "./ink-surface";
import { PaperSurface } from "./paper-surface";
import { SmokeLayer } from "./smoke-layer";
import { boxFrame, closeupFrame, Fit, fitFrame, Frame, Size, unframe } from "./projection";
import { useMapGestures } from "./use-map-gestures";

export type SurfaceMode = "ink" | "paper";
export type ScreenPoint = { x: number; y: number; visible: boolean };

type StageValue = {
  data: InkMapData;
  size: Size;
  version: number;
  project: (point: Point, lift?: number) => ScreenPoint;
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

// The flat map draws a rectangle of ground. The 3D camera fits the whole overview rectangle on
// screen, and shows a bit more than a close-up's, so a close-up's flat frame is widened to hold
// roughly the same streets and then fills the screen.
function frameEdges(view: InkMapView): [number, number, number, number] {
  if (view.kind === "overview") return [view.fit.x0, view.fit.y0, view.fit.x1, view.fit.y1];
  const frame = closeupFrame(view.center, view.radius * 2.6);
  return [frame.x0, frame.y0, frame.x1, frame.y1];
}

const flatFit = (view: InkMapView): Fit => (view.kind === "overview" ? "contain" : "cover");

const HIDDEN: ScreenPoint = { x: 0, y: 0, visible: false };

export function MapStage({
  data,
  view,
  mode: requestedMode = "ink",
  hazard,
  minutes,
  fronts,
  forecast,
  highlights,
  onPick,
  onHover,
  onContextPick,
  focus,
  interactive = false,
  underlay,
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
  // Forecast bands the 3D map draws on the ground. The flat map has no shader, so it draws none.
  forecast?: StageForecast | null;
  highlights?: Map<number, BuildingState>;
  onPick?: (point: Point) => void;
  onHover?: (point: Point | null) => void;
  onContextPick?: (point: Point, screen: { x: number; y: number }) => void;
  focus?: FlyTarget | null;
  interactive?: boolean;
  underlay?: ReactNode;
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
  const fit = flatFit(view);
  // The ground the flat map shows, edge to edge of the box.
  const frame = useMemo<Frame | null>(() => (size ? boxFrame({ x0, y0, x1, y1 }, size, fit) : null), [x0, y0, x1, y1, size, fit]);
  const projection = useMemo(() => createProjection(data.origin), [data.origin]);
  const { toLatLng, toLocal } = projection;


  const renderer = mode === "ink" ? handle?.renderer ?? null : null;
  const dragged = useMapGestures(boxRef, renderer);
  useFlyTo(renderer, focus);

  const groundAt = useCallback(
    (event: ClientPoint) => {
      const box = boxRef.current;
      if (!size || !frame || !box) return null;
      const rect = box.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const ground = mode === "paper" ? unframe(frame, size, x, y) : handle?.renderer.pickGround(x, y) ?? null;
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

  const hover = useHoverPick(groundAt, onHover);

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
    () => (size && frame ? stageValue({ data, size, handle, mode, frame, toLocal, toLatLng }) : null),
    [data, size, handle, mode, frame, toLocal, toLatLng],
  );

  return (
    <div
      ref={boxRef}
      onClick={onPick ? click : undefined}
      {...hover}
      onContextMenu={onContextPick ? contextMenu : undefined}
      className={`relative isolate size-full touch-none overflow-hidden bg-canvas ${cursorFor(interactive, mode)} ${className}`}
    >
      <StageSurface mode={mode} data={data} view={view} frame={frame} size={size} hazard={hazard} minutes={minutes} fronts={fronts} forecast={forecast} highlights={highlights} onHandle={setHandle} onFail={fail} />
      {value && (
        <StageContext.Provider value={value}>
          {underlay && <OverlayLayer size={value.size}>{underlay}</OverlayLayer>}
          <OverlayLayer size={value.size}>{children}</OverlayLayer>
          {mode === "ink" && hazard && <SmokeLayer fronts={hazard.field.fronts} minutes={minutes ?? 0} />}
          {controls}
        </StageContext.Provider>
      )}
    </div>
  );
}

// Each overlay is its own compositor layer, so a marker that changes repaints only the markers and
// never the large fire and forecast shapes underneath, which change once a minute at most.
function OverlayLayer({ size, children }: { size: { width: number; height: number }; children: ReactNode }) {
  return (
    <svg width={size.width} height={size.height} className="pointer-events-none absolute inset-0 will-change-transform" aria-hidden>
      {children}
    </svg>
  );
}

// The ground under the pointer, at most once a frame: picking on the 3D surface marches a ray
// over the terrain, too much work to repeat for every mouse event.
type ClientPoint = { clientX: number; clientY: number };

function useHoverPick(groundAt: (event: ClientPoint) => { ground: Point } | null, onHover: ((point: Point | null) => void) | undefined) {
  const frame = useRef(0);
  const latest = useRef<ClientPoint | null>(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const move = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      latest.current = { clientX: event.clientX, clientY: event.clientY };
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (latest.current) onHover?.(groundAt(latest.current)?.ground ?? null);
      });
    },
    [groundAt, onHover],
  );
  const leave = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    onHover?.(null);
  }, [onHover]);
  return onHover ? { onMouseMove: move, onMouseLeave: leave } : {};
}

const EMPTY: Map<number, BuildingState> = new Map();

export type StageForecast = { field: ForecastField; aheadMinutes: number };

type SurfaceProps = {
  mode: SurfaceMode;
  data: InkMapData;
  view: InkMapView;
  frame: Frame | null;
  size: Size | null;
  hazard?: Hazard | null;
  minutes?: number;
  fronts?: { minutes: number; ring: Point[] }[];
  forecast?: StageForecast | null;
  highlights?: Map<number, BuildingState>;
  onHandle: (handle: InkMapHandle | null) => void;
  onFail: () => void;
};

function StageSurface({ mode, data, view, frame, size, hazard, minutes = 0, fronts = [], forecast, highlights = EMPTY, onHandle, onFail }: SurfaceProps) {
  if (mode === "ink") {
    return <InkSurface data={data} view={view} hazard={hazard ?? null} minutes={minutes} forecast={forecast} highlights={highlights} onHandle={onHandle} onFail={onFail} />;
  }
  if (!size || !frame) return null;
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
  const flat = fitFrame(frame, size);
  const project = mode === "paper" ? flat : ink ? (point: Point, lift = 0) => ink.project(point, lift) : () => HIDDEN;
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
