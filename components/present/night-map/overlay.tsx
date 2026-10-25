"use client";

import { useEffect, useMemo, useRef } from "react";
import type { InkMapData, Point } from "@/lib/ink-map/data";
import type { InkMapRenderer } from "@/lib/ink-map/renderer";
import { runRoute } from "@/lib/ink-map/road-route";
import type { Beat } from "../script";
import { STAGE } from "../stage";
import type { DeckCrowd } from "./crowd";
import { CROWD_RUNS, layersFor, type Layers } from "./layers";
import {
  paintCensus,
  paintCrowd,
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
import type { RescuePlan } from "./rescue-plan";
import type { Town } from "./town";

// How fast the crowd night runs against the wall clock, and how much of each frame it may take.
const CROWD_SPEED = 30;
const CROWD_BUDGET_MS = 10;
const FLICKER_MS = 130;
const ROUTE_DRAW_MS = 1800;
const EVERYONE_ROUTES = 60;

type Paint = { ctx: CanvasRenderingContext2D; project: Project; elapsed: number; palette: Palette };
export type CloseRoutes = { house: Point[]; everyone: Point[][] };
type Scene = { town: Town; plan: RescuePlan; crowd: DeckCrowd; close: CloseRoutes; houseCenter: Point };

const progressOf = (elapsed: number, delay = 0) => Math.min(Math.max((elapsed - delay) / ROUTE_DRAW_MS, 0), 1);

// Rescue crews for the close come in from depots spaced around the zone's edge, so the routes to
// every needing home join into one network from the edges inward.
const DEPOTS = 7;

function nearestStart(starts: Point[], [x, y]: Point) {
  return starts.reduce((best, start) => (Math.hypot(start[0] - x, start[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? start : best));
}

function depotsOn(zone: Point[]) {
  return Array.from({ length: DEPOTS }, (_, i) => zone[Math.floor((i / DEPOTS) * zone.length)]);
}

export function useCloseRoutes(data: InkMapData | null, town: Town | null, houseCenter: Point | null) {
  return useMemo<CloseRoutes | null>(() => {
    if (!data || !town || !houseCenter) return null;
    const depots = depotsOn(town.zone);
    const route = (to: Point) => runRoute(data, nearestStart(depots, to), [to], new Set()) ?? [];
    const needing = town.homes.filter((home) => home.census === "need");
    const step = Math.max(1, Math.floor(needing.length / EVERYONE_ROUTES));
    const everyone = needing.filter((_, i) => i % step === 0).map((home) => route(home.at));
    return { house: route(houseCenter), everyone };
  }, [data, town, houseCenter]);
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

function paintPlan(paint: Paint, layers: Layers, scene: Scene) {
  const { ctx, project, elapsed, palette } = paint;
  const { plan } = scene;
  if (layers.requests) paintRequests(ctx, project, plan.stops, { elapsed, color: palette.signal, night: palette.night });
  if (layers.candidates) {
    const tried = plan.tried[Math.floor(elapsed / FLICKER_MS) % plan.tried.length];
    for (const route of tried) strokeRoute(ctx, project, route, { color: palette.ink, width: 1.8, progress: 1 });
  }
  if (layers.routes !== "off") {
    const faint = layers.routes === "faint";
    for (const [v, route] of plan.routes.entries()) {
      const color = plan.rescuers[v].kind === "engine" ? palette.ink : palette.ride;
      ctx.globalAlpha = faint ? 0.25 : 1;
      strokeRoute(ctx, project, route, { color, width: faint ? 2 : 3.5, progress: faint ? 1 : progressOf(elapsed, v * 120), glow: faint ? 0 : 8 });
    }
    ctx.globalAlpha = 1;
  }
  if (layers.rescuers) for (const rescuer of plan.rescuers) paintRescuer(ctx, project(rescuer.start), rescuer.kind, palette);
}

function paintPeople(paint: Paint, layers: Layers, scene: Scene) {
  const { ctx, project, elapsed, palette } = paint;
  const { town, plan, crowd, close } = scene;
  if (layers.crowd !== "off") paintCrowd(ctx, project, crowd.movingDots(), { jams: layers.crowd === "jams", alpha: layers.crowd === "faint" ? 0.3 : 1, palette });
  if (layers.maria) {
    strokeRoute(ctx, project, plan.routes[0], { color: palette.ride, width: 6, progress: progressOf(elapsed, 600), glow: 16 });
    paintRescuer(ctx, project(town.maria.at), "neighbour", palette);
  }
  if (layers.roseland !== "off") {
    const color = layers.roseland === "ride" && elapsed > 600 + ROUTE_DRAW_MS ? palette.ride : palette.signal;
    paintMarker(ctx, project(town.roseland.at), { color, night: palette.night, radius: 14, rings: layers.roseland !== "ride", elapsed });
  }
  if (layers.rescue === "house") strokeRoute(ctx, project, close.house, { color: palette.ride, width: 6, progress: progressOf(elapsed, 1400), glow: 16 });
  if (layers.rescue === "everyone") {
    for (const [i, route] of close.everyone.entries()) strokeRoute(ctx, project, route, { color: palette.ride, width: 3, progress: progressOf(elapsed, 600 + (i % 20) * 90), glow: 8 });
  }
}

type OverlayProps = { renderer: InkMapRenderer | null; beat: Beat; scene: Scene | null };

// Everything the deck draws on the night map from 3.1 on, re-projected every frame so it stays
// pinned to the ground while the camera moves.
export function MapOverlay({ renderer, beat, scene }: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beatStarted = useRef({ beat, at: 0 });

  useEffect(() => {
    beatStarted.current = { beat, at: performance.now() };
  }, [beat]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !renderer || !scene) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = STAGE.width * ratio;
    canvas.height = STAGE.height * ratio;
    const palette = readPalette();
    const project: Project = (point) => renderer.project(point);
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const { beat: current, at } = beatStarted.current;
      if (CROWD_RUNS.includes(current)) {
        scene.crowd.run(((now - last) / 1000) * CROWD_SPEED, CROWD_BUDGET_MS);
        renderer.setFireMinutes(scene.crowd.sim.minutes);
      }
      last = now;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, STAGE.width, STAGE.height);
      const paint = { ctx, project, elapsed: now - at, palette };
      const layers = layersFor(current);
      paintTown(paint, layers, scene);
      paintPlan(paint, layers, scene);
      paintPeople(paint, layers, scene);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [renderer, scene]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden />;
}
