"use client";

import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { MapStage, SurfaceMode } from "@/components/map/map-stage";
import { ZoomControls } from "@/components/map/zoom-controls";
import { PanelDesk } from "@/components/ui/panel-desk";
import { TOWN_FRAME } from "@/components/map/projection";
import { useBuildingHighlights } from "@/components/map/use-highlights";
import { LatLng } from "@/lib/geo";
import { createProjection, InkMapData, Point } from "@/lib/ink-map/data";
import { useDangerZones } from "@/lib/ink-map/danger";
import { useFireClock, useHazard } from "@/lib/ink-map/hazard";
import { DangerLayer, ForecastControl } from "./danger-zones";
import { DoorCheckPanel, NominationPanel } from "./field-panel";
import { FireSpreadLayer } from "./fire-spread-layer";
import { FleetPanel } from "./fleet-panel";
import { DrawingHint, FireScrubber, MapToolbar, MapTopBar } from "./map-chrome";
import { ContextAction, ContextSpot, MapContextMenu } from "./map-context-menu";
import { MapOverlays } from "./map-overlays";
import { homeMarks, requestMarks } from "./marks";
import { HomesPanel } from "./homes-panel";
import { NeedPanel } from "./need-panel";
import { Person, useRescueBoard } from "./use-rescue-board";
import { PlanPanel } from "./plan-panel";
import { RiderUpload } from "./map-tools";
import { useDrawingTools } from "./use-drawing-tools";

const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;

export function RescueMap() {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const danger = useDangerZones(data?.origin);
  const [forecastShown, setForecastShown] = useState(true);
  const control = useQuery(api.control.get);
  const clock = useFireClock(hazard, control?.warningIssuedAt);

  const [mode, setMode] = useState<SurfaceMode>("ink");
  const { toLatLng, toLocal } = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }), [data?.origin]);

  const board = useRescueBoard(data ?? null, toLocal);
  const { homes, withOpenRequest, highlights, stillHome } = useRoofs(data ?? null, board.people, toLocal);
  const { focus, flyTarget, focusProps } = usePersonFocus();
  const [vanFocusId, setVanFocusId] = useState<string | null>(null);

  const drawing = useDrawingTools(data ?? null, toLatLng);
  const { tool, setTool, startFrom } = drawing;
  const [spot, setSpot] = useState<ContextSpot | null>(null);
  const closeMenu = useCallback(() => setSpot(null), []);
  const startFromSpot = useCallback(
    (action: ContextAction, point: Point) => {
      startFrom(action, point);
      setSpot(null);
    },
    [startFrom],
  );

  if (!data) return <p className="type-body grid h-[100dvh] place-items-center text-ink-muted">Loading the map of Altadena…</p>;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-map-paper">
      <MapStage
        data={data}
        view={VIEW}
        mode={mode}
        hazard={hazard}
        minutes={clock.minutes}
        fronts={hazard?.field.fronts}
        highlights={highlights}
        onPick={drawing.pick}
        onHover={drawing.hover}
        onContextPick={(point, screen) => setSpot({ point, screen })}
        focus={flyTarget}
        interactive={tool !== "look"}
        className="absolute inset-0"
        controls={<ZoomControls className="absolute right-[21.75rem] bottom-24" />}
        underlay={
          <>
            {danger && forecastShown && <DangerLayer danger={danger} minutes={clock.minutes} />}
            <FireSpreadLayer hazard={hazard} minutes={clock.minutes} />
          </>
        }
      >
        <MapOverlays zone={drawing.zone} street={drawing.street} people={board.people} vans={board.vans} focusId={focus} stillHome={stillHome} vanFocusId={vanFocusId} onVanHover={setVanFocusId} />
      </MapStage>

      <PanelDesk storageKey="rescue-map-panels">
        <div className="pointer-events-none absolute inset-0 flex flex-col">
          <MapTopBar issuedAt={control?.warningIssuedAt} />
          <div className="flex min-h-0 flex-1 items-stretch gap-3 p-3">
            <div className="pointer-events-auto flex w-[25rem] max-w-[40vw] shrink-0 flex-col gap-3 overflow-y-auto pr-1">
              <HomesPanel homes={homes} withOpenRequest={withOpenRequest} />
              <NeedPanel people={board.people} focus={focusProps} className="shrink" />
              <NominationPanel />
            </div>
            <div className="min-w-0 flex-1" />
            <div className="pointer-events-auto flex w-[20rem] max-w-[32vw] shrink-0 flex-col gap-3 overflow-y-auto pl-1">
              <PlanPanel />
              <FleetPanel vans={board.vans} onVanHover={setVanFocusId} />
              <DoorCheckPanel />
              <RiderUpload />
            </div>
          </div>
          <div className="flex items-end gap-3 p-3 pt-0">
            <MapToolbar tool={tool} mode={mode} onTool={setTool} onMode={setMode}>
              <DrawingHint tool={tool} status={drawing.status} zone={drawing.zone} onUndo={drawing.undoCorner} onSave={drawing.saveZone} />
            </MapToolbar>
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <FireScrubber clock={clock}>
                {danger && <ForecastControl danger={danger} shown={forecastShown} onToggle={() => setForecastShown((shown) => !shown)} />}
              </FireScrubber>
            </div>
          </div>
        </div>
      </PanelDesk>
      <MapContextMenu spot={spot} hazard={hazard} danger={danger} minutes={clock.minutes} toLatLng={toLatLng} onAction={startFromSpot} onClose={closeMenu} />
    </div>
  );
}

// Every household's roof: red while it has a ride request open, dark while it is still home, clear
// once it has left.
function useRoofs(data: InkMapData | null, people: Person[], toLocal: (point: LatLng) => Point) {
  const coverage = useQuery(api.households.coverage);
  const homes = useMemo(() => coverage ?? [], [coverage]);
  const withOpenRequest = useMemo(() => new Set<string>(people.map((person) => person.householdId)), [people]);
  const occupancy = useMemo(() => homeMarks(homes, withOpenRequest, toLocal), [homes, withOpenRequest, toLocal]);
  const marks = useMemo(() => [...occupancy, ...requestMarks(people)], [occupancy, people]);
  const highlights = useBuildingHighlights(data, marks);
  const stillHome = useMemo(() => occupancy.filter((mark) => mark.occupancy === "stillHome").map((mark) => mark.point), [occupancy]);
  return { homes, withOpenRequest, highlights, stillHome };
}

// A row clicked in the list flies the map to that person and rings their pin; a row hovered rings
// it without moving the map, so the list and the map point at each other.
function usePersonFocus() {
  const [picked, setPicked] = useState<Person | null>(null);
  const [hovered, setHovered] = useState<Person | null>(null);
  const focus = hovered?._id ?? picked?._id ?? null;
  const flyTarget = useMemo(() => (picked ? { point: picked.at, key: picked._id } : null), [picked]);
  const focusProps = useMemo(
    () => ({
      focusId: picked?._id ?? null,
      onFocus: (person: Person) => setPicked((current) => (current?._id === person._id ? null : person)),
      onHover: setHovered,
    }),
    [picked],
  );
  return { focus, flyTarget, focusProps };
}
