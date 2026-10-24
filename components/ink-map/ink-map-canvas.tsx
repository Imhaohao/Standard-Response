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

// Owns the WebGL canvas. Every resize re-renders the static ink pass and bumps `version`,
// which tells overlays to re-project their markers.
export function InkMapCanvas({
  data,
  view,
  onReady,
  className = "",
}: {
  data: InkMapData;
  view: InkMapView;
  onReady: (handle: InkMapHandle | null) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  const viewKey = JSON.stringify(view);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parsedView = JSON.parse(viewKey) as InkMapView;
    const renderer = new InkMapRenderer(canvas, data, parsedView, {
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      detailRoads: parsedView.kind === "closeup",
    });
    let version = 0;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 2 || height < 2) return;
      renderer.resize(width, height);
      version += 1;
      onReadyRef.current({ renderer, data, size: { width, height }, version });
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      onReadyRef.current(null);
      renderer.dispose();
    };
  }, [data, viewKey]);

  return <canvas ref={canvasRef} className={`block size-full ${className}`} />;
}
