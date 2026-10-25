"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

export type Project = (point: Point, lift?: number) => ScreenPoint;
type Projector = (project: Project) => void;

type StageValue = {
  data: InkMapData;
  size: Size;
  version: number;
  project: Project;
  // Calls back on every camera move, in the same task that draws the map. See useProjected.
  subscribe: (projector: Projector) => () => void;
  zoomLevel: () => number;
  toScreen: (point: LatLng) => ScreenPoint;
  toLocal: (point: LatLng) => Point;
  toLatLng: (point: Point) => LatLng;
  zoomBy: (factor: number) => void;
  resetView: () => void;
};

const StageContext = createContext<StageValue | null>(null);

export function useMapStage() {
  const stage = useContext(StageContext);
  if (!stage) throw new Error("useMapStage must be used inside MapStage");
  return stage;
}

// Keeps something drawn over the map on its spot as the camera moves. `update` places it with the
// current camera after every render and again on every pan or zoom, by setting attributes on the
// element directly in the same task that draws the map, so markers never trail the streets and
// React never re-renders the overlays while the map moves.
export function useProjected(update: Projector) {
  const { project, subscribe } = useMapStage();
  const latest = useRef(update);
  useLayoutEffect(() => {
    latest.current = update;
    update(project);
  });
  useEffect(() => subscribe((current) => latest.current(current)), [subscribe]);
}

// For drawings that are cheap to re-render whole: a number that changes whenever the camera moves.
export function useCameraVersion() {
  const { subscribe } = useMapStage();
  const [version, setVersion] = useState(0);
  useEffect(() => subscribe(() => setVersion((current) => current + 1)), [subscribe]);
  return version;
}

function useCameraSubscribers(renderer: InkMapRenderer | null, project: Project | undefined) {
  const projectors = useRef(new Set<Projector>());
  const latestProject = useRef(project);
  useEffect(() => {
    latestProject.current = project;
  }, [project]);
  useEffect(() => {
    if (!renderer) return;
    const stop = renderer.onViewChange(() => {
      const current = latestProject.current;
      if (current) for (const projector of projectors.current) projector(current);
    });
    return () => void stop();
  }, [renderer]);
  return useCallback((projector: Projector) => {
    projectors.current.add(projector);
    return () => void projectors.current.delete(projector);
  }, []);
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

  // Until the canvas has a size there is nothing to project into.
  const projector = useMemo(() => (size && frame ? projectorFor(mode, handle, frame, size) : undefined), [mode, handle, frame, size]);
  const subscribe = useCameraSubscribers(renderer, projector);
  const value = useMemo(
    () => (size && frame && projector ? stageValue({ data, size, handle, mode, project: projector, subscribe, toLocal, toLatLng }) : null),
    [data, size, handle, mode, projector, subscribe, frame, toLocal, toLatLng],
  );

  return (
    <div
      ref={boxRef}
      onClick={onPick ? click : undefined}
      {...hover}
      onContextMenu={onContextPick ? contextMenu : undefined}
      className={`relative isolate size-full touch-none overflow-hidden bg-canvas ${cursorFor(interactive, mode)} ${className}`}
    >
      <StageSurface mode={mode} data={data} view={view} frame={frame} size={size} hazard={hazard} minutes={minutes} forecast={forecast} highlights={highlights} onHandle={setHandle} onFail={fail} />
      {value && (
        <StageContext.Provider value={value}>
          {underlay && <OverlayLayer size={value.size}>{underlay}</OverlayLayer>}
          {/* Smoke covers the ground and the fire's own marks, never the people and vans drawn in
              `children`: nobody waiting for help may disappear under a plume. */}
          {mode === "ink" && <HazardSmoke hazard={hazard} minutes={minutes} />}
          <OverlayLayer size={value.size}>{children}</OverlayLayer>
          {controls}
        </StageContext.Provider>
      )}
    </div>
  );
}

// Smoke rises only from a hazard that burns.
function HazardSmoke({ hazard, minutes = 0 }: { hazard?: Hazard | null; minutes?: number }) {
  if (!hazard || hazard.burns === false) return null;
  return <SmokeLayer fronts={hazard.field.fronts} minutes={minutes} />;
}

// One SVG per overlay. They are left to the browser's own layering: forcing each onto a full-screen
// compositor layer made every camera move re-raster the whole layer and stalled zooms.
function OverlayLayer({ size, children }: { size: { width: number; height: number }; children: ReactNode }) {
  return (
    <svg width={size.width} height={size.height} className="pointer-events-none absolute inset-0" aria-hidden>
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
  forecast?: StageForecast | null;
  highlights?: Map<number, BuildingState>;
  onHandle: (handle: InkMapHandle | null) => void;
  onFail: () => void;
};

function StageSurface({ mode, data, view, frame, size, hazard, minutes = 0, forecast, highlights = EMPTY, onHandle, onFail }: SurfaceProps) {
  if (mode === "ink") {
    return <InkSurface data={data} view={view} hazard={hazard ?? null} minutes={minutes} forecast={forecast} highlights={highlights} onHandle={onHandle} onFail={onFail} />;
  }
  if (!size || !frame) return null;
  return (
    <svg width={size.width} height={size.height} className="absolute inset-0" role="img" aria-label="Flat map of Altadena: streets, hills and the fire front">
      <PaperSurface data={data} frame={frame} size={size} field={hazard?.field ?? null} burns={hazard?.burns !== false} minutes={minutes} />
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
  project: Project;
  subscribe: StageValue["subscribe"];
  toLocal: (point: LatLng) => Point;
  toLatLng: (point: Point) => LatLng;
};

// Markers are projected from the live camera on the 3D surface, and from the flat frame on the
// 2D one.
function projectorFor(mode: SurfaceMode, handle: InkMapHandle | null, frame: Frame, size: Size): Project {
  if (mode === "paper") return fitFrame(frame, size);
  const ink = handle?.renderer;
  return ink ? (point, lift = 0) => ink.project(point, lift) : () => HIDDEN;
}

function stageValue({ data, size, handle, mode, project, subscribe, toLocal, toLatLng }: StageInputs): StageValue {
  const ink = mode === "ink" ? handle?.renderer : undefined;
  return {
    data,
    size,
    version: handle?.version ?? 0,
    project,
    subscribe,
    zoomLevel: () => ink?.zoom ?? 1,
    toScreen: (point) => project(toLocal(point)),
    toLocal,
    toLatLng,
    zoomBy: (factor) => ink?.zoomAt(factor, size.width / 2, size.height / 2),
    resetView: () => ink?.resetView(),
  };
}
