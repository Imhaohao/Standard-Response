"use client";

import { useEffect, useRef, useState } from "react";
import { InkMapData, loadInkMapData } from "@/lib/ink-map/data";
import type { InkMapView } from "@/lib/ink-map/camera";
import { InkMapRenderer } from "@/lib/ink-map/renderer";

export type InkMapHandle = { renderer: InkMapRenderer; data: InkMapData; size: { width: number; height: number }; version: number };

export function useInkMapData() {
  const [data, setData] = useState<InkMapData | null>(null);
  useEffect(() => {
    let live = true;
    void loadInkMapData().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, []);
  return data;
}

// A machine without WebGL gets null, and the stage falls back to the flat map.
function createRenderer(canvas: HTMLCanvasElement, data: InkMapData, view: InkMapView) {
  try {
    return new InkMapRenderer(canvas, data, view, {
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      detailRoads: view.kind === "closeup",
    });
  } catch {
    return null;
  }
}

// Owns the WebGL canvas. Every resize re-renders the ink pass and bumps `version`. Pans and zooms
// don't: overlays follow those through the renderer's view listeners (useProjected in map-stage).
export function InkMapCanvas({
  data,
  view,
  onReady,
  onFail,
  className = "",
}: {
  data: InkMapData;
  view: InkMapView;
  onReady: (handle: InkMapHandle | null) => void;
  onFail?: () => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onReadyRef.current = onReady;
    onFailRef.current = onFail;
  });
  const viewKey = JSON.stringify(view);

  // Each renderer draws on a canvas of its own. Disposing a renderer gives up its WebGL context (and
  // the memory in it) at once, and a canvas whose context is lost can't make another one.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = `block size-full ${className}`;
    host.appendChild(canvas);
    const parsedView = JSON.parse(viewKey) as InkMapView;
    const renderer = createRenderer(canvas, data, parsedView);
    if (!renderer) {
      canvas.remove();
      onFailRef.current?.();
      return;
    }
    let version = 0;
    let size = { width: 1, height: 1 };
    const announce = () => {
      version += 1;
      onReadyRef.current({ renderer, data, size, version });
    };
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 2 || height < 2) return;
      size = { width, height };
      renderer.resize(width, height);
      announce();
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      onReadyRef.current(null);
      renderer.dispose();
      canvas.remove();
    };
  }, [data, viewKey, className]);

  return <div ref={hostRef} className="size-full" />;
}
