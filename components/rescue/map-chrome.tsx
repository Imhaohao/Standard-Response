"use client";

import { ArrowClockwise, Cube, Cursor, MapTrifold, Path, RoadHorizon } from "@phosphor-icons/react";
import { ReactNode } from "react";
import { FireClock } from "@/lib/ink-map/hazard";
import { AppBar, WarningClock } from "../ui/app-bar";
import { Button } from "../ui/button";
import { SegmentedControl } from "./segmented-control";

export function MapTopBar({ issuedAt }: { issuedAt: number | undefined }) {
  return <AppBar>{issuedAt && <WarningClock issuedAt={issuedAt} />}</AppBar>;
}

export type MapTool = "look" | "zone" | "closure";
type MapMode = "ink" | "paper";

const TOOLS = [
  { value: "look", label: "Look around", Icon: Cursor },
  { value: "zone", label: "Draw warning zone", Icon: Path },
  { value: "closure", label: "Close a road", Icon: RoadHorizon },
] as const;

const MODES = [
  { value: "ink", label: "3D", Icon: Cube },
  { value: "paper", label: "Flat", Icon: MapTrifold },
] as const;

const TOOL_HINTS: Record<MapTool, string> = {
  look: "",
  zone: "Click corners, Enter to save",
  closure: "Click both ends of the road",
};

// The surface every bar along the bottom of the map shares.
export function ChromeSurface({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`pointer-events-auto rounded-2xl bg-panel/96 text-on-panel shadow-float backdrop-blur-md ${className}`}>{children}</div>;
}

export function MapToolbar({
  tool,
  mode,
  onTool,
  onMode,
  children,
}: {
  tool: MapTool;
  mode: MapMode;
  onTool: (tool: MapTool) => void;
  onMode: (mode: MapMode) => void;
  children?: ReactNode;
}) {
  const hint = TOOL_HINTS[tool] || children;
  return (
    <div className="flex flex-col items-start gap-2">
      {hint && <ChromeSurface className="type-small px-3 py-1.5 font-semibold">{hint}</ChromeSurface>}
      <ChromeSurface className="flex items-center gap-2 p-1.5">
        <SegmentedControl options={TOOLS} value={tool} onChange={onTool} ariaLabel="Map tool" />
        <SegmentedControl options={MODES} value={mode} onChange={onMode} ariaLabel="Map view" />
      </ChromeSurface>
    </div>
  );
}

export const scenarioClock = (minutes: number) => {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  return hours > 0 ? `${hours}h ${whole % 60}m` : `${whole}m`;
};

const SCENARIO_NOTE = "Scenario input, not a forecast";

function ClockState({ previewing }: { previewing: boolean }) {
  return (
    <span className={`type-small inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-bold ${previewing ? "bg-on-panel text-panel" : "bg-surface-sunk"}`}>
      <span className={`size-2 rounded-full ${previewing ? "bg-panel" : "bg-on-panel"}`} aria-hidden />
      {previewing ? "Preview" : "Now"}
    </span>
  );
}

export function FireScrubber({ clock, label }: { clock: FireClock; label: string }) {
  return (
    <ChromeSurface className="flex w-full max-w-2xl items-center gap-3 px-3 py-2">
      <ClockState previewing={clock.scrubbing} />
      <input
        type="range"
        min={0}
        max={clock.last || 1}
        value={Math.round(clock.minutes)}
        onChange={(event) => clock.scrub(Number(event.target.value))}
        aria-label="Minutes after the warning"
        className="h-1 min-w-0 flex-1 accent-signal"
      />
      <span className="type-small w-12 shrink-0 text-right font-semibold tabular-nums" title="After the warning">
        +{scenarioClock(clock.minutes)}
      </span>
      {clock.scrubbing && (
        <Button variant="onPanel" className="!h-8 !rounded-lg !px-2.5 !text-xs" onClick={clock.follow}>
          <ArrowClockwise weight="bold" className="size-3.5" />
          Back to now
        </Button>
      )}
      <span title={label} className="type-small shrink-0 rounded-md bg-surface-sunk px-1.5 py-0.5 text-on-panel-muted">
        {SCENARIO_NOTE}
      </span>
    </ChromeSurface>
  );
}
