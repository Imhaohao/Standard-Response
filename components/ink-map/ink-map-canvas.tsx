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

// Owns the WebGL canvas. Every resize or pan/zoom re-renders the ink pass and bumps `version`,
// which tells overlays to re-project their markers.
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onReadyRef = useRef(onReady);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onReadyRef.current = onReady;
    onFailRef.current = onFail;
  });
  const viewKey = JSON.stringify(view);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parsedView = JSON.parse(viewKey) as InkMapView;
    const renderer = createRenderer(canvas, data, parsedView);
    if (!renderer) {
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
    const stopListening = renderer.onViewChange(announce);
    return () => {
      stopListening();
      observer.disconnect();
      onReadyRef.current(null);
      renderer.dispose();
    };
  }, [data, viewKey]);

  return <canvas ref={canvasRef} className={`block size-full ${className}`} />;
}
