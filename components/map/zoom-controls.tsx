"use client";

import { ArrowsIn, Minus, Plus } from "@phosphor-icons/react";
import { useCameraVersion, useMapStage } from "./map-stage";

const BUTTON =
  "grid size-10 place-items-center text-on-panel hover:bg-panel-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink disabled:opacity-40";

// Zoom buttons for people who don't use a wheel or a pinch. Home appears once the view has moved.
export function ZoomControls({ className = "" }: { className?: string }) {
  const { zoomBy, resetView, zoomLevel } = useMapStage();
  useCameraVersion();
  const zoomed = zoomLevel() > 1.01;
  return (
    <div className={`pointer-events-auto flex flex-col overflow-hidden rounded-xl bg-panel shadow-float ${className}`} onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label="Zoom in" className={BUTTON} onClick={() => zoomBy(1.6)}>
        <Plus weight="bold" className="size-4" />
      </button>
      <button type="button" aria-label="Zoom out" className={BUTTON} onClick={() => zoomBy(1 / 1.6)} disabled={!zoomed}>
        <Minus weight="bold" className="size-4" />
      </button>
      {zoomed && (
        <button type="button" aria-label="Show the whole town" className={BUTTON} onClick={resetView}>
          <ArrowsIn weight="bold" className="size-4" />
        </button>
      )}
    </div>
  );
}
