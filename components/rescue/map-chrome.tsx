"use client";

import { ArrowClockwise, ArrowCounterClockwise, Check, Cube, Cursor, Fire, FireExtinguisher, Icon, MapTrifold, Path, RoadHorizon } from "@phosphor-icons/react";
import { ReactNode } from "react";
import { FireClock } from "@/lib/ink-map/hazard";
import { AppBar, WarningClock } from "../ui/app-bar";
import { Button } from "../ui/button";
import { SegmentedControl } from "./segmented-control";
import type { ZoneDraft } from "./use-drawing-tools";

export function MapTopBar({ issuedAt }: { issuedAt: number | undefined }) {
  return <AppBar>{issuedAt && <WarningClock issuedAt={issuedAt} />}</AppBar>;
}

export type MapTool = "look" | "zone" | "closure" | "ignite";
type MapMode = "ink" | "paper";

const TOOLS = [
  { value: "look", label: "Look around", Icon: Cursor },
  { value: "zone", label: "Draw warning zone", Icon: Path },
  { value: "closure", label: "Close a road", Icon: RoadHorizon },
  { value: "ignite", label: "Start a fire", Icon: Fire },
] as const;

const MODES = [
  { value: "ink", label: "3D", Icon: Cube },
  { value: "paper", label: "Flat", Icon: MapTrifold },
] as const;

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
  return (
    <div className="flex flex-col items-start gap-2">
      {children}
      <ChromeSurface className="flex items-center gap-2 p-1.5">
        <SegmentedControl options={TOOLS} value={tool} onChange={onTool} ariaLabel="Map tool" />
        <SegmentedControl options={MODES} value={mode} onChange={onMode} ariaLabel="Map view" />
      </ChromeSurface>
    </div>
  );
}

function HintAction({ Icon, label, onClick }: { Icon: Icon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="type-small inline-flex h-7 items-center gap-1.5 rounded-lg px-2 font-semibold transition-colors duration-150 hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-on-panel"
    >
      <Icon weight="bold" className="size-3.5" />
      {label}
    </button>
  );
}

function zoneInstruction(zone: ZoneDraft | null) {
  if (!zone || zone.corners.length === 0) return "Click a street corner to start the zone";
  if (zone.previewCrosses) return "That edge would cross the zone";
  if (zone.corners.length < 3) return "Click the next corner";
  return "Click the first corner to finish";
}

function HintSurface({ children }: { children: ReactNode }) {
  return <ChromeSurface className="type-small flex min-h-9 items-center gap-1 py-1 pr-1 pl-3 font-semibold">{children}</ChromeSurface>;
}

// One line over the toolbar: what a click on the map will do now, or what the last click did.
export function DrawingHint({
  tool,
  status,
  zone,
  onUndo,
  onSave,
}: {
  tool: MapTool;
  status: string;
  zone: ZoneDraft | null;
  onUndo: () => void;
  onSave: () => void;
}) {
  if (tool === "closure") return <HintSurface><span className="pr-2">{status || "Click a street to close it"}</span></HintSurface>;
  if (tool === "ignite") return <HintSurface><span className="pr-2">Click a house to start a fire there</span></HintSurface>;
  if (tool === "look") return status ? <HintSurface><span className="pr-2">{status}</span></HintSurface> : null;
  return (
    <HintSurface>
      <span className="pr-2">{zoneInstruction(zone)}</span>
      {zone && zone.corners.length > 0 && <HintAction Icon={ArrowCounterClockwise} label="Undo corner" onClick={onUndo} />}
      {zone && zone.corners.length >= 3 && <HintAction Icon={Check} label="Save zone" onClick={onSave} />}
    </HintSurface>
  );
}

// While a rehearsal fire stands in for the scenario, the way back to the scenario stays in reach.
export function SimulatedFireHint({ onClear }: { onClear: () => void }) {
  return (
    <HintSurface>
      <Fire weight="fill" className="size-4 shrink-0 text-signal" aria-hidden />
      <span className="pr-2">Simulated fire, clock started when you lit it</span>
      <HintAction Icon={FireExtinguisher} label="Put it out" onClick={onClear} />
    </HintSurface>
  );
}

export const scenarioClock = (minutes: number) => {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  return hours > 0 ? `${hours}h ${whole % 60}m` : `${whole}m`;
};

function ClockState({ previewing }: { previewing: boolean }) {
  return (
    <span className={`type-small inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-bold ${previewing ? "bg-on-panel text-panel" : "bg-surface-sunk"}`}>
      <span className={`size-2 rounded-full ${previewing ? "bg-panel" : "bg-on-panel"}`} aria-hidden />
      {previewing ? "Preview" : "Now"}
    </span>
  );
}

// The fire over time: the minute being shown, and below it whatever is drawn for that minute.
export function FireScrubber({ clock, children }: { clock: FireClock; children?: ReactNode }) {
  return (
    <ChromeSurface className="flex w-full max-w-2xl flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center gap-3">
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
        <span className="type-small w-14 shrink-0 text-right font-semibold tabular-nums" title="After the warning">
          +{scenarioClock(clock.minutes)}
        </span>
        {clock.scrubbing && (
          <Button variant="onPanel" className="!h-8 !rounded-lg !px-2.5 !text-xs" onClick={clock.follow}>
            <ArrowClockwise weight="bold" className="size-3.5" />
            Back to now
          </Button>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-1.5">{children}</div>}
    </ChromeSurface>
  );
}
