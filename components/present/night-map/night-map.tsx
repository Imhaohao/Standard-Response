"use client";

import { animate, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InkMapCanvas, InkMapHandle } from "@/components/ink-map/ink-map-canvas";
import { TOWN_FRAME } from "@/components/map/projection";
import type { InkMapView } from "@/lib/ink-map/camera";
import type { BuildingState, InkMapRenderer } from "@/lib/ink-map/renderer";
import { CAMERA_GLIDE_SECONDS, cameraMove } from "../motion";
import type { Beat } from "../script";
import { CallWave } from "./call-wave";
import { HouseMark } from "./house-mark";
import { MapOverlay, useCloseRoutes } from "./overlay";
import { useDeckCrowd } from "./crowd";
import { useRescuePlan } from "./rescue-plan";
import { HouseState, SHOTS, type Focus, type Shot } from "./shots";
import { centroid, type Town } from "./town";
import type { Point } from "@/lib/ink-map/data";
import { STAGE } from "../stage";
import type { StoryMap } from "./use-story-map";

// The map's paper and ink after dark, as sRGB floats; the paper is --night, the ink --on-night-muted.
const NIGHT_PAPER = [0.071, 0.057, 0.047] as const;
const NIGHT_INK = [0.662, 0.641, 0.62] as const;
const NIGHT_CHARCOAL = [0.025, 0.02, 0.017] as const;

const FIRE_RUN_SECONDS = 3.2;

const ROOFS: Record<HouseState, BuildingState | null> = {
  hidden: null,
  lit: { level: 1, pulse: true },
  calling: { level: 1, pulse: true },
  out: { level: 0, pulse: false, occupancy: "stillHome" },
};

function useNightRenderer(handle: InkMapHandle | null, story: StoryMap) {
  const renderer = handle?.renderer ?? null;
  useEffect(() => {
    if (!renderer) return;
    renderer.setPalette(NIGHT_PAPER, NIGHT_INK, NIGHT_CHARCOAL);
    renderer.setFire(story.fire);
    renderer.setNextFront(false);
    return () => renderer.stop();
  }, [renderer, story.fire]);
  return renderer;
}

// The fire animates only while the map is on screen, and stops once the map has faded out.
const MAP_FADE_MS = 2200;

function useRunWhileShown(renderer: InkMapRenderer | null, shown: boolean) {
  useEffect(() => {
    if (!renderer) return;
    if (shown) {
      renderer.start();
      return;
    }
    const timer = window.setTimeout(() => renderer.stop(), MAP_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [renderer, shown]);
}

function useHouseRoof(renderer: InkMapRenderer | null, story: StoryMap, state: HouseState) {
  useEffect(() => {
    const roof = ROOFS[state];
    renderer?.setBuildingStates(new Map(roof ? [[story.house.id, roof]] : []));
  }, [renderer, story.house.id, state]);
}

// The ground point that puts `center` offsetX pixels from the middle of the stage at `zoom`. Solves the
// screen's response to a step east and a step north, measured at the current zoom and scaled to the target.
function shiftedFocus(renderer: InkMapRenderer, [x, y]: Point, zoom: number, offsetX: number): Point {
  const base = renderer.project([x, y]);
  const east = renderer.project([x + 100, y]);
  const north = renderer.project([x, y + 100]);
  const [a, b] = [(east.x - base.x) / 100, (north.x - base.x) / 100];
  const [c, d] = [(east.y - base.y) / 100, (north.y - base.y) / 100];
  const shift = (-offsetX * renderer.zoom) / zoom;
  const det = a * d - b * c;
  return [x + (shift * d) / det, y - (shift * c) / det];
}

function focusPoint(story: StoryMap, town: Town | null, focus: Focus, safe: Point | null): Point | null {
  if (focus === "house") return story.house.center;
  if (focus === "roseland") return town?.roseland.at ?? story.house.center;
  if (focus === "zone") return town ? centroid(town.zone) : story.house.center;
  if (focus === "rescue") return town && safe ? centroid([town.roseland.at, safe]) : story.house.center;
  return null;
}

function focusFor(renderer: InkMapRenderer, center: Point | null, shot: Shot): Point | null {
  if (!center) return shot.offsetX ? renderer.pickGround(STAGE.width / 2 - shot.offsetX, STAGE.height / 2) : null;
  if (!shot.offsetX) return center;
  return shiftedFocus(renderer, center, shot.zoom, shot.offsetX);
}

// The camera pans rather than the canvas sliding, so the map always fills the stage.
function useCamera(renderer: InkMapRenderer | null, center: Point | null, shot: Shot) {
  const { zoom, offsetX } = shot;
  const [x, y] = center ?? [NaN, NaN];
  useEffect(() => {
    if (!renderer) return;
    renderer.glideTo(focusFor(renderer, center, shot), zoom, CAMERA_GLIDE_SECONDS * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the framing fields move the camera
  }, [renderer, x, y, zoom, offsetX]);
}

// The fire runs forward or back to its beat's minute instead of jumping there.
function useFireMinutes(renderer: InkMapRenderer | null, minutes: number) {
  const current = useRef(minutes);
  useEffect(() => {
    if (!renderer) return;
    const controls = animate(current.current, minutes, {
      duration: FIRE_RUN_SECONDS,
      ease: [0.4, 0, 0.2, 1],
      onUpdate: (value) => {
        current.current = value;
        renderer.setFireMinutes(value);
      },
    });
    return () => controls.stop();
  }, [renderer, minutes]);
}

type NightMapProps = { beat: Beat; story: StoryMap; town: Town | null };

export function NightMap({ beat, story, town }: NightMapProps) {
  const shot = SHOTS[beat];
  const [handle, setHandle] = useState<InkMapHandle | null>(null);
  const view = useMemo<InkMapView>(() => ({ kind: "overview", fit: TOWN_FRAME }), []);
  const renderer = useNightRenderer(handle, story);
  const plan = useRescuePlan(story.data, town);
  const crowd = useDeckCrowd(story.data, story.scenario, town);
  const close = useCloseRoutes(story, town);
  const scene = useMemo(() => (town && plan && crowd && close ? { town, plan, crowd, close, houseCenter: story.house.center } : null), [town, plan, crowd, close, story.house.center]);
  useRunWhileShown(renderer, shot.shown);
  useHouseRoof(renderer, story, shot.house);
  useCamera(renderer, focusPoint(story, town, shot.focus, plan?.safe ?? null), shot);
  useFireMinutes(renderer, shot.fire * story.house.arrives);
  const fading = beat === "gone";

  return (
    <motion.div className="absolute inset-0" initial={false} animate={{ opacity: shot.shown ? 1 : 0 }} transition={cameraMove} aria-hidden>
      <InkMapCanvas data={story.data} view={view} onReady={setHandle} />
      <CallWave renderer={renderer} homes={story.homes} running={shot.wave} />
      <MapOverlay renderer={renderer} beat={beat} scene={scene} />
      <HouseMark renderer={renderer} center={story.house.center} state={shot.house} />
      <motion.div
        className="absolute inset-0 bg-night"
        initial={false}
        animate={{ opacity: shot.dark }}
        transition={{ duration: fading ? 3.5 : 1.2, delay: fading ? 1.8 : 0, ease: [0.2, 0, 0, 1] }}
      />
    </motion.div>
  );
}
