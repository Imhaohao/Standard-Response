"use client";

import { Cube, Cursor, MapTrifold, Path, RoadHorizon } from "@phosphor-icons/react";
import { FireClock } from "@/lib/ink-map/hazard";
import { AppBar, WarningClock } from "../ui/app-bar";
import { Button } from "../ui/button";

export function MapTopBar({ issuedAt }: { issuedAt: number | undefined }) {
  return <AppBar>{issuedAt && <WarningClock issuedAt={issuedAt} />}</AppBar>;
}

export type MapTool = "look" | "zone" | "closure";

const TOOLS = [
  { key: "look", label: "Look around", Icon: Cursor },
  { key: "zone", label: "Draw warning zone", Icon: Path },
  { key: "closure", label: "Close a road", Icon: RoadHorizon },
] as const;

const TOOL_HINTS: Record<MapTool, string> = {
  look: "",
  zone: "Click the map to add corners, then finish the zone.",
  closure: "Click where the road closes, then where it opens again.",
};

function ToolButton({ tool, active, onTool }: { tool: (typeof TOOLS)[number]; active: boolean; onTool: (tool: MapTool) => void }) {
  const { Icon, label, key } = tool;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onTool(key)}
      className={`inline-flex h-9 items-center gap-2 px-3 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${
        active ? "bg-on-panel text-panel" : "text-on-panel hover:bg-panel-raised"
      }`}
    >
      <Icon weight="bold" className="size-4" />
      <span className="type-small hidden md:inline">{label}</span>
    </button>
  );
}

export function MapToolbar({
  tool,
  mode,
  onTool,
  onMode,
  children,
}: {
  tool: MapTool;
  mode: "ink" | "paper";
  onTool: (tool: MapTool) => void;
  onMode: (mode: "ink" | "paper") => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="pointer-events-auto flex flex-col gap-2">
      <div className="flex items-center gap-1 self-start border border-panel-raised bg-panel/96 p-1 text-on-panel backdrop-blur-md">
        {TOOLS.map((entry) => (
          <ToolButton key={entry.key} tool={entry} active={tool === entry.key} onTool={onTool} />
        ))}
        <span className="mx-1 h-6 w-px bg-panel-raised" aria-hidden />
        <button
          type="button"
          aria-pressed={mode === "ink"}
          onClick={() => onMode("ink")}
          className={`inline-flex h-9 items-center gap-2 px-3 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${
            mode === "ink" ? "bg-on-panel text-panel" : "text-on-panel hover:bg-panel-raised"
          }`}
        >
          <Cube weight="bold" className="size-4" />
          <span className="type-small hidden md:inline">3D</span>
        </button>
        <button
          type="button"
          aria-pressed={mode === "paper"}
          onClick={() => onMode("paper")}
          className={`inline-flex h-9 items-center gap-2 px-3 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${
            mode === "paper" ? "bg-on-panel text-panel" : "text-on-panel hover:bg-panel-raised"
          }`}
        >
          <MapTrifold weight="bold" className="size-4" />
          <span className="type-small hidden md:inline">Flat</span>
        </button>
        {children}
      </div>
      {tool !== "look" && <p className="type-small self-start bg-panel/96 px-3 py-1.5 text-on-panel backdrop-blur-md">{TOOL_HINTS[tool]}</p>}
    </div>
  );
}

const scenarioClock = (minutes: number) => {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  return hours > 0 ? `${hours}h ${whole % 60}m` : `${whole}m`;
};

export function FireScrubber({ clock, label }: { clock: FireClock; label: string }) {
  return (
    <div className="pointer-events-auto flex w-full max-w-xl flex-col gap-1 border border-panel-raised bg-panel/96 px-3 py-2 text-on-panel backdrop-blur-md">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={clock.last || 1}
          value={Math.round(clock.minutes)}
          onChange={(event) => clock.scrub(Number(event.target.value))}
          aria-label="Minutes after the warning"
          className="h-1 min-w-0 flex-1 accent-signal"
        />
        <span className="type-small shrink-0 whitespace-nowrap font-semibold tabular-nums">{scenarioClock(clock.minutes)} after the warning</span>
        {clock.scrubbing && (
          <Button variant="onPanelQuiet" className="!h-7 !px-2.5 !text-xs" onClick={clock.follow}>
            Back to now
          </Button>
        )}
      </div>
      <p className="type-small text-on-panel-muted">{label}</p>
    </div>
  );
}
