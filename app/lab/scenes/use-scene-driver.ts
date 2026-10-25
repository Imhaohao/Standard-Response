"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HazardImpact } from "@/lib/ink-map/hazard-layers/types";
import type { InkMapRenderer } from "@/lib/ink-map/renderer";

// What a recorder drives the scene with: window.__scene. Every setter resolves once the change
// has reached the canvas, so a capture taken after `await` shows it.
export type SceneHandle = {
  ready: Promise<void>;
  frames: string[];
  minutes: () => number;
  lastMinute: () => number;
  setMinutes: (minutes: number) => Promise<void>;
  play: (speed?: number) => void;
  pause: () => void;
  setFrame: (name: string) => Promise<void>;
  // Pins the animation clock (flicker, water, snow) to these seconds; null lets it run again.
  setSeconds: (seconds: number | null) => Promise<void>;
  impact: () => HazardImpact | null;
};

declare global {
  interface Window {
    __scene?: SceneHandle;
  }
}

const READY_ATTRIBUTE = "data-scene-ready";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

// Minutes advance at `speed` scenario minutes per wall-clock second while playing, and stop at the end.
export function usePlayback(last: number, initial: { minutes: number; play: boolean; speed: number }) {
  const [minutes, setMinutes] = useState(initial.minutes);
  const [playing, setPlaying] = useState(initial.play);
  const [speed, setSpeed] = useState(initial.speed);
  const shown = useRef(minutes);
  useEffect(() => {
    shown.current = minutes;
  }, [minutes]);
  useEffect(() => {
    if (!playing || last <= 0) return;
    let frame = 0;
    let previous = performance.now();
    const step = (now: number) => {
      const next = Math.min(last, shown.current + ((now - previous) / 1000) * speed);
      previous = now;
      shown.current = next;
      setMinutes(next);
      if (next >= last) return setPlaying(false);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, last]);
  return { minutes, setMinutes, playing, setPlaying, speed, setSpeed };
}

type DriverInputs = {
  renderer: InkMapRenderer | null;
  hazardShown: boolean;
  minutes: number;
  last: number;
  frames: string[];
  frame: string;
  setMinutes: (minutes: number) => void;
  play: (speed?: number) => void;
  pause: () => void;
  setFrame: (name: string) => void;
};

// Publishes window.__scene and marks the page data-scene-ready once the first frame with the hazard
// on it has been drawn, and again after every frame change rebuilds the renderer.
export function useSceneDriver(inputs: DriverInputs) {
  const latest = useRef(inputs);
  const readyOnce = useRef(deferred());
  const readyWaiters = useRef<(() => void)[]>([]);
  const minuteWaiters = useRef<(() => void)[]>([]);
  useEffect(() => {
    latest.current = inputs;
  });

  const { renderer, hazardShown, minutes } = inputs;
  useEffect(() => {
    const root = document.documentElement;
    root.removeAttribute(READY_ATTRIBUTE);
    if (!renderer || !hazardShown) return;
    let live = true;
    void renderer.nextFrame().then(() => {
      if (!live) return;
      root.setAttribute(READY_ATTRIBUTE, "true");
      readyOnce.current.resolve();
      for (const resolve of readyWaiters.current.splice(0)) resolve();
    });
    return () => {
      live = false;
    };
  }, [renderer, hazardShown]);

  // Runs after the map's own effects have handed the minute to the renderer.
  useEffect(() => {
    if (!renderer || minuteWaiters.current.length === 0) return;
    const waiting = minuteWaiters.current.splice(0);
    void renderer.nextFrame().then(() => waiting.forEach((resolve) => resolve()));
  }, [renderer, minutes]);

  const handle = useCallback(
    (): SceneHandle => ({
      ready: readyOnce.current.promise,
      get frames() {
        return latest.current.frames;
      },
      minutes: () => latest.current.minutes,
      lastMinute: () => latest.current.last,
      setMinutes: (next) =>
        new Promise<void>((resolve) => {
          const { renderer: current, minutes: now } = latest.current;
          if (current && next === now) return void current.nextFrame().then(resolve);
          minuteWaiters.current.push(resolve);
          latest.current.setMinutes(next);
        }),
      play: (speed) => latest.current.play(speed),
      pause: () => latest.current.pause(),
      setFrame: (name) =>
        new Promise<void>((resolve) => {
          if (name === latest.current.frame) return void readyOnce.current.promise.then(resolve);
          readyWaiters.current.push(resolve);
          latest.current.setFrame(name);
        }),
      setSeconds: async (seconds) => {
        const current = latest.current.renderer;
        if (!current) return;
        const drawn = current.nextFrame();
        current.freezeTime(seconds);
        await drawn;
      },
      impact: () => latest.current.renderer?.hazardImpact(latest.current.minutes) ?? null,
    }),
    [],
  );

  useEffect(() => {
    window.__scene = handle();
    return () => {
      delete window.__scene;
    };
  }, [handle]);
}
