import { Cube, MapTrifold } from "@phosphor-icons/react";
import { ReactNode } from "react";
import { SegmentedControl } from "../ui/segmented-control";
import type { SurfaceMode } from "./map-stage";

const VIEWS = [
  { value: "ink", label: "3D", Icon: Cube },
  { value: "paper", label: "Flat", Icon: MapTrifold },
] as const;

// The surface every bar floating over a map shares.
export function ChromeSurface({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`pointer-events-auto card bg-panel/96 backdrop-blur-md ${className}`}>{children}</div>;
}

export function MapViewControl({ mode, onMode }: { mode: SurfaceMode; onMode: (mode: SurfaceMode) => void }) {
  return <SegmentedControl options={VIEWS} value={mode} onChange={onMode} ariaLabel="Map view" />;
}
