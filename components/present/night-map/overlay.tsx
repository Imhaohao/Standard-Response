"use client";

import { useEffect, useMemo, useRef } from "react";
import type { InkMapData, Point } from "@/lib/ink-map/data";
import { arrivalMinutesAt, type FireField } from "@/lib/ink-map/fire-field";
import type { InkMapRenderer } from "@/lib/ink-map/renderer";
import { runRoute } from "@/lib/ink-map/road-route";
import type { Beat } from "../script";
import { STAGE, stageCanvasRatio } from "../stage";
import type { DeckCrowd } from "./crowd";
import { CROWD_RUNS, drawsOverlay, layersFor, type Layers } from "./layers";
import {
  paintCensus,
  paintCrowd,
  paintTraffic,
  paintMarker,
  paintRequests,
  paintRescuer,
  paintRinging,
  paintZone,
  readPalette,
  strokeRoute,
  type Palette,
  type Project,
} from "./painters";
import type { RescuePlan, Rescuer } from "./rescue-plan";
import { SHOTS } from "./shots";
import type { Town } from "./town";
import type { StoryMap } from "./use-story-map";

// How fast the crowd night runs against the wall clock, and how much of each frame it may take.
const CROWD_SPEED = 30;
const CROWD_BUDGET_MS = 10;
const FLICKER_MS = 130;
// A street needs this many cars on it before it is coloured, so one car alone does not paint a road.
const TRAFFIC_MIN_CARS = 2;
const ROUTE_DRAW_MS = 1800;
const EVERYONE_ROUTES = 60;

type Paint = { ctx: CanvasRenderingContext2D; project: Project; elapsed: number; palette: Palette };
export type CloseRoutes = { house: Point[]; everyone: Point[][] };
type Scene = { town: Town; plan: RescuePlan; crowd: DeckCrowd; close: CloseRoutes; houseCenter: Point };

const progressOf = (elapsed: number, delay = 0) => Math.min(Math.max((elapsed - delay) / ROUTE_DRAW_MS, 0), 1);

// Rescue crews for the close come in from depots spaced around the zone's edge, so the routes to
// every needing home join into one network from the edges inward. The close shows the fire at
// SHOTS.everyone's share of its run, so the crews drive only streets it hasn't reached by then and
// go only to homes it hasn't reached.
const DEPOTS = 7;

function nearestStart(starts: Point[], [x, y]: Point) {
  return starts.reduce((best, start) => (Math.hypot(start[0] - x, start[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? start : best));
}

function depotsOn(zone: Point[], clear: (point: Point) => boolean) {
  const open = zone.filter(clear);
  const ring = open.length >= DEPOTS ? open : zone;
  return Array.from({ length: DEPOTS }, (_, i) => ring[Math.floor((i / DEPOTS) * ring.length)]);
}

// Drive-graph blocks the fire has reached by `minutes`, judged at the middle of each block.
function burnedBlocks(data: InkMapData, fire: FireField, minutes: number) {
  const burned = new Set<string>();
  for (const edge of data.graph.edges) {
    const middle = edge.shape[Math.floor(edge.shape.length / 2)];
    const arrives = middle ? arrivalMinutesAt(fire, middle) : null;
    if (arrives !== null && arrives <= minutes) burned.add(edge.key);
  }
  return burned;
}

export function useCloseRoutes(story: StoryMap, town: Town | null) {
  return useMemo<CloseRoutes | null>(() => {
    if (!town) return null;
    const { data, fire, house } = story;
    const minutes = SHOTS.everyone.fire * house.arrives;
    const clear = (point: Point) => (arrivalMinutesAt(fire, point) ?? Infinity) > minutes;
    const burned = burnedBlocks(data, fire, minutes);
    const depots = depotsOn(town.zone, clear);
    const route = (to: Point) => runRoute(data, nearestStart(depots, to), [to], burned);
    const needing = town.homes.filter((home) => home.census === "need" && clear(home.at));
    const step = Math.max(1, Math.floor(needing.length / EVERYONE_ROUTES));
    const everyone = needing
      .filter((_, i) => i % step === 0)
      .map((home) => route(home.at))
      .filter((run): run is Point[] => run !== null && run.length > 1);
    return { house: route(house.center) ?? [], everyone };
  }, [story, town]);
}

function paintTown(paint: Paint, layers: Layers, scene: Scene) {
  const { ctx, project, elapsed, palette } = paint;
  const { town } = scene;
  if (layers.zone !== "off") {
    const alpha = layers.zone === "faint" ? 0.35 : 1;
    paintZone(ctx, project, town.zone, { progress: layers.zone === "draw" ? elapsed / 2200 : 1, alpha, ink: palette.ink });
  }
  if (layers.homes === "ring") paintRinging(ctx, project, town.homes, town.roseland.at, elapsed, palette);
  if (layers.homes === "census") paintCensus(ctx, project, town.homes, { elapsed, alpha: 1, palette });
  if (layers.homes === "dim") paintCensus(ctx, project, town.homes, { elapsed: Infinity, alpha: 0.3, palette });
}

// Neighbors drive solid amber lines, the colour of "can help" on the census. Emergency services
// drive dashed light lines. Every run carries arrows the way it is driven.
function fleetStyle(kind: Rescuer["kind"], palette: Palette) {
  return kind === "engine" ? { color: palette.ink, dashed: true } : { color: palette.ride, dashed: false };
}

function paintCandidates(paint: Paint, plan: RescuePlan) {
  const { ctx, project, elapsed, palette } = paint;
  const tried = plan.tried[Math.floor(elapsed / FLICKER_MS) % plan.tried.length];
  ctx.globalAlpha = 0.75;
  for (const [v, route] of tried.entries()) {
    strokeRoute(ctx, project, route, { ...fleetStyle(plan.rescuers[v].kind, palette), width: 2, progress: 1, arrows: true });
  }
  ctx.globalAlpha = 1;
}

function paintRoutes(paint: Paint, plan: RescuePlan, faint: boolean) {
  const { ctx, project, elapsed, palette } = paint;
  ctx.globalAlpha = faint ? 0.25 : 1;
  for (const [v, route] of plan.routes.entries()) {
    const style = fleetStyle(plan.rescuers[v].kind, palette);
    strokeRoute(ctx, project, route, { ...style, width: faint ? 2 : 3.5, progress: faint ? 1 : progressOf(elapsed, v * 120), glow: faint ? 0 : 8, arrows: !faint });
  }
  ctx.globalAlpha = 1;
}

function paintPlan(paint: Paint, layers: Layers, scene: Scene) {
  const { ctx, project, elapsed, palette } = paint;
  const { plan } = scene;
  if (layers.requests) paintRequests(ctx, project, plan.stops, { elapsed, color: palette.signal, night: palette.night });
  if (layers.candidates) paintCandidates(paint, plan);
  if (layers.routes !== "off") paintRoutes(paint, plan, layers.routes === "faint");
  if (layers.rescuers) for (const rescuer of plan.rescuers) paintRescuer(ctx, project(rescuer.start), rescuer.kind, palette);
  if (layers.routes === "draw" || layers.candidates) paintMarker(ctx, project(plan.safe), { color: palette.leaving, night: palette.night, radius: 13, rings: false, elapsed });
}

// The close's crews are emergency services, drawn the way the rescue map draws them.
function paintClose(paint: Paint, layers: Layers, close: CloseRoutes) {
  const { ctx, project, elapsed, palette } = paint;
  const crew = fleetStyle("engine", palette);
  if (layers.rescue === "house") strokeRoute(ctx, project, close.house, { ...crew, width: 5, progress: progressOf(elapsed, 1400), glow: 14, arrows: true });
  if (layers.rescue !== "everyone") return;
  for (const [i, route] of close.everyone.entries()) {
    strokeRoute(ctx, project, route, { ...crew, width: 2.5, progress: progressOf(elapsed, 600 + (i % 20) * 90), glow: 6, arrows: true });
  }
}

function paintPeople(paint: Paint, layers: Layers, scene: Scene) {
  const { ctx, project, elapsed, palette } = paint;
  const { town, crowd, close } = scene;
  if (layers.crowd === "flow" || layers.crowd === "jams") paintTraffic(ctx, project, crowd.streetFlow(TRAFFIC_MIN_CARS), { glow: layers.crowd === "jams", palette });
  if (layers.crowd !== "off") paintCrowd(ctx, project, crowd.movingDots(), { jams: false, alpha: layers.crowd === "faint" ? 0.3 : 0.7, palette });
  if (layers.roseland !== "off") {
    paintMarker(ctx, project(town.roseland.at), { color: palette.signal, night: palette.night, radius: 14, rings: true, elapsed });
  }
  if (layers.rescue !== "off") paintClose(paint, layers, close);
}

type OverlayProps = { renderer: InkMapRenderer | null; beat: Beat; scene: Scene | null };
type BeatStart = { beat: Beat; at: number };

// Paints every frame for the time-based layers, and again inside each camera move, so a glide never
// shows this frame's map under last frame's dots. A frame the camera already painted isn't painted twice.
function runOverlay(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, renderer: InkMapRenderer, scene: Scene, started: { current: BeatStart }) {
  const ratio = stageCanvasRatio();
  canvas.width = STAGE.width * ratio;
  canvas.height = STAGE.height * ratio;
  const palette = readPalette();
  const project: Project = (point) => renderer.project(point);
  let paintedAt = -Infinity;
  const paintAll = (now: number) => {
    const { beat, at } = started.current;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, STAGE.width, STAGE.height);
    const paint = { ctx, project, elapsed: now - at, palette };
    const layers = layersFor(beat);
    paintTown(paint, layers, scene);
    paintPlan(paint, layers, scene);
    paintPeople(paint, layers, scene);
    paintedAt = performance.now();
  };
  let frame = 0;
  let last = performance.now();
  const tick = (now: number) => {
    if (CROWD_RUNS.includes(started.current.beat)) {
      scene.crowd.run(((now - last) / 1000) * CROWD_SPEED, CROWD_BUDGET_MS);
      renderer.setFireMinutes(scene.crowd.sim.minutes);
    }
    last = now;
    if (paintedAt < now) paintAll(now);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const stopFollowing = renderer.onViewChange(() => paintAll(performance.now()));
  return () => {
    cancelAnimationFrame(frame);
    stopFollowing();
  };
}

// Everything the deck draws on the night map from 3.1 on, re-projected every frame so it stays
// pinned to the ground while the camera moves.
export function MapOverlay({ renderer, beat, scene }: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beatStarted = useRef<BeatStart>({ beat, at: 0 });

  useEffect(() => {
    beatStarted.current = { beat, at: performance.now() };
  }, [beat]);

  const drawing = drawsOverlay(beat);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !renderer || !scene) return;
    // An idle canvas still costs a full upload to the GPU every time it's cleared, so it stops instead.
    if (!drawing) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    return runOverlay(canvas, ctx, renderer, scene, beatStarted);
  }, [renderer, scene, drawing]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden />;
}
