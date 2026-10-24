"use client";

import { ArrowCounterClockwise, Check, Cursor, Fire, FireExtinguisher, Icon, Path, Pause, Play, RoadHorizon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import { ReactNode, useState } from "react";
import { api } from "@/convex/_generated/api";
import { ChromeSurface, MapViewControl } from "@/components/map/map-bar";
import type { SurfaceMode } from "@/components/map/map-stage";
import { FireClock } from "@/lib/ink-map/hazard";
import { Crews, FireResponse } from "@/lib/ink-map/ignition";
import { PLAYBACK_SPEEDS } from "@/lib/sim-clock";
import { AppBar, WarningClock } from "../ui/app-bar";
import { Button } from "../ui/button";
import { SegmentedControl } from "../ui/segmented-control";
import type { ZoneDraft } from "./use-drawing-tools";

export function MapTopBar({ issuedAt }: { issuedAt: number | undefined }) {
  return <AppBar>{issuedAt && <WarningClock issuedAt={issuedAt} />}</AppBar>;
}

export type MapTool = "look" | "zone" | "closure" | "ignite";

const TOOLS = [
  { value: "look", label: "Look around", Icon: Cursor },
  { value: "zone", label: "Draw warning zone", Icon: Path },
  { value: "closure", label: "Close a road", Icon: RoadHorizon },
  { value: "ignite", label: "Start a fire", Icon: Fire },
] as const;

export function MapToolbar({
  tool,
  mode,
  onTool,
  onMode,
  children,
}: {
  tool: MapTool;
  mode: SurfaceMode;
  onTool: (tool: MapTool) => void;
  onMode: (mode: SurfaceMode) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      {children}
      <ChromeSurface className="flex items-center gap-2 p-1.5">
        <SegmentedControl options={TOOLS} value={tool} onChange={onTool} ariaLabel="Map tool" />
        <MapViewControl mode={mode} onMode={onMode} />
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
      <span className="pr-2">{status || zoneInstruction(zone)}</span>
      {zone && zone.corners.length > 0 && <HintAction Icon={ArrowCounterClockwise} label="Undo corner" onClick={onUndo} />}
      {zone && zone.corners.length >= 3 && <HintAction Icon={Check} label="Save zone" onClick={onSave} />}
    </HintSurface>
  );
}

const CONSTRUCTION = [
  { value: "older", label: "Older homes" },
  { value: "hardened", label: "Wildfire-code homes" },
] as const;

const CREWS = [
  { value: "0", label: "No crews" },
  { value: "1", label: "1 engine" },
  { value: "3", label: "3 engines" },
] as const;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function fireOutcome({ burned, outAt, homesReached }: SimulatedFireSummary) {
  const reach = `${count(burned, "building", "buildings")} burn, ${count(homesReached, "household", "households")} to warn`;
  return outAt === null ? `Still spreading at the end of the run: ${reach}` : `Out by +${scenarioClock(outAt)}: ${reach}`;
}

export type SimulatedFireSummary = { burned: number; outAt: number | null; homesReached: number };

// While a rehearsal fire stands in for the scenario, how it ends and who it reaches stay in view,
// along with how the homes are built, how many crews respond and the way back to the scenario.
export function SimulatedFireHint({
  summary,
  response,
  onResponse,
  onClear,
}: {
  summary: SimulatedFireSummary;
  response: FireResponse;
  onResponse: (response: FireResponse) => void;
  onClear: () => void;
}) {
  return (
    <ChromeSurface className="type-small flex flex-col gap-1.5 p-1.5 font-semibold">
      <div className="flex min-h-8 items-center gap-1 pl-1.5">
        <Fire weight="fill" className="size-4 shrink-0 text-signal" aria-hidden />
        <span className="pr-2 tabular-nums" aria-live="polite">{fireOutcome(summary)}</span>
        <HintAction Icon={FireExtinguisher} label="Put it out" onClick={onClear} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl options={CONSTRUCTION} value={response.construction} onChange={(construction) => onResponse({ ...response, construction })} ariaLabel="How the homes are built" />
        <SegmentedControl options={CREWS} value={String(response.engines) as `${Crews}`} onChange={(engines) => onResponse({ ...response, engines: Number(engines) as Crews })} ariaLabel="Fire crews responding" />
      </div>
    </ChromeSurface>
  );
}

export const scenarioClock = (minutes: number) => {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  return hours > 0 ? `${hours}h ${whole % 60}m` : `${whole}m`;
};

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` }));

// The night's clock, which everyone on the deployment shares: play or pause it and pick how fast it
// runs. The bar shows how far the fire scenario has got and can't be dragged, since calls,
// dispatch and the vans all run on this clock and none of them can jump ahead.
export function PlaybackBar({ clock, children }: { clock: FireClock; children?: ReactNode }) {
  const playback = usePlayback();
  return (
    <ChromeSurface className="flex w-full max-w-2xl flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center gap-3">
        <Button variant="onPanel" size="sm" square onClick={playback.toggle} aria-label={playback.paused ? "Play" : "Pause"} title={playback.paused ? "Play" : "Pause"}>
          {playback.paused ? <Play weight="fill" className="size-4 translate-x-px" /> : <Pause weight="fill" className="size-4" />}
        </Button>
        <SegmentedControl options={SPEED_OPTIONS} value={String(playback.speed)} onChange={(value) => playback.setSpeed(Number(value))} ariaLabel="Playback speed" />
        <FireProgress clock={clock} paused={playback.paused} />
        <span className="type-small w-16 shrink-0 text-right font-semibold tabular-nums" title="After the warning">
          +{scenarioClock(clock.minutes)}
        </span>
      </div>
      {children && <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-1.5">{children}</div>}
    </ChromeSurface>
  );
}

function FireProgress({ clock, paused }: { clock: FireClock; paused: boolean }) {
  const share = clock.last ? Math.min(1, clock.minutes / clock.last) : 0;
  const tone = paused ? "bg-on-panel-muted" : "bg-signal";
  return (
    <div
      role="progressbar"
      aria-label="Fire scenario"
      aria-valuemin={0}
      aria-valuemax={Math.round(clock.last)}
      aria-valuenow={Math.round(clock.minutes)}
      aria-valuetext={`${scenarioClock(clock.minutes)} after the warning`}
      className="relative h-1 min-w-0 flex-1 rounded-full bg-line"
    >
      <div className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${share * 100}%` }} />
      <div className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_var(--color-panel)] ${tone}`} style={{ left: `${share * 100}%` }} />
    </div>
  );
}

function usePlayback() {
  const clock = useQuery(api.control.get)?.clock;
  const setPlayback = useMutation(api.control.setPlayback);
  const speed = clock?.speed ?? 1;
  const [resumeAt, setResumeAt] = useState(1);
  const paused = speed === 0;
  return {
    paused,
    speed: paused ? resumeAt : speed,
    toggle: () => {
      if (!paused) setResumeAt(speed);
      void setPlayback({ speed: paused ? resumeAt : 0 });
    },
    setSpeed: (next: number) => {
      setResumeAt(next);
      if (!paused) void setPlayback({ speed: next });
    },
  };
}
