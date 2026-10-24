"use client";

import { Copy, Path, RoadHorizon } from "@phosphor-icons/react";
import { ComponentType, useEffect, useRef } from "react";
import { LatLng } from "@/lib/geo";
import { chanceAt, DangerZones } from "@/lib/ink-map/danger";
import { Point } from "@/lib/ink-map/data";
import { arrivalAt, NEVER_BURNS } from "@/lib/ink-map/fire-field";
import { Hazard } from "@/lib/ink-map/hazard";
import { scenarioClock } from "./map-chrome";

export type ContextSpot = { point: Point; screen: { x: number; y: number } };
export type ContextAction = "closure" | "zone";

const MENU_WIDTH = 256;
const MENU_HEIGHT = 230;
const EDGE_GAP = 8;

function scenarioArrival(hazard: Hazard | null, point: Point, minutes: number) {
  if (!hazard) return "No scenario loaded";
  const arrival = arrivalAt(hazard.field.fronts, point[0], point[1]);
  if (arrival >= NEVER_BURNS) return "Past the last front";
  if (arrival <= minutes) return "Already burned";
  return `In ${scenarioClock(arrival - minutes)}`;
}

function forecastChance(danger: DangerZones | null, point: Point, minutes: number) {
  if (!danger) return "No forecast loaded";
  const chance = chanceAt(danger, minutes, point);
  if (chance === null) return `Under ${Math.round(Math.min(...danger.probabilities) * 100)}%`;
  return `At least ${Math.round(chance * 100)}%`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-on-panel-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function MenuItem({ Icon, label, onSelect }: { Icon: ComponentType<{ weight?: "bold"; className?: string }>; label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="type-small flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-semibold transition-colors duration-150 hover:bg-panel-raised focus-visible:bg-panel-raised focus-visible:outline-none"
    >
      <Icon weight="bold" className="size-4 shrink-0" />
      {label}
    </button>
  );
}

function useDismiss(menu: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const press = (event: PointerEvent) => !menu.current?.contains(event.target as Node) && onClose();
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", press, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", press, true);
    };
  }, [menu, onClose]);
}

type MenuProps = {
  spot: ContextSpot | null;
  hazard: Hazard | null;
  danger: DangerZones | null;
  minutes: number;
  toLatLng: (point: Point) => LatLng;
  onAction: (action: ContextAction, point: Point) => void;
  onClose: () => void;
};

// Right-click on the map: what the fire is doing at that spot, and the tools that start there.
export function MapContextMenu(props: MenuProps) {
  return props.spot ? <OpenMenu {...props} spot={props.spot} /> : null;
}

function OpenMenu({ spot, hazard, danger, minutes, toLatLng, onAction, onClose }: MenuProps & { spot: ContextSpot }) {
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(menu, onClose);
  const left = Math.min(spot.screen.x, window.innerWidth - MENU_WIDTH - EDGE_GAP);
  const top = Math.min(spot.screen.y, window.innerHeight - MENU_HEIGHT - EDGE_GAP);
  const { lat, lng } = toLatLng(spot.point);

  const copy = () => {
    void navigator.clipboard?.writeText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`).catch(() => undefined);
    onClose();
  };

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Map actions at this spot"
      style={{ left, top, width: MENU_WIDTH }}
      className="pointer-events-auto absolute z-50 rounded-xl bg-panel p-1.5 text-on-panel shadow-float"
      onContextMenu={(event) => event.preventDefault()}
    >
      <dl className="type-small flex flex-col gap-1 px-2.5 pt-1.5 pb-2.5">
        <Fact label="Scenario fire" value={scenarioArrival(hazard, spot.point, minutes)} />
        <Fact label={`Forecast by +${scenarioClock(minutes)}`} value={forecastChance(danger, spot.point, minutes)} />
      </dl>
      <div className="flex flex-col gap-0.5 border-t border-line pt-1">
        <MenuItem Icon={RoadHorizon} label="Close a road from here" onSelect={() => onAction("closure", spot.point)} />
        <MenuItem Icon={Path} label="Start a warning zone here" onSelect={() => onAction("zone", spot.point)} />
        <MenuItem Icon={Copy} label="Copy coordinates" onSelect={copy} />
      </div>
    </div>
  );
}
