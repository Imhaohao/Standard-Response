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
import { DrawingHint, FireScrubber, MapToolbar, MapTopBar, SimulatedFireHint } from "./map-chrome";
import { ContextAction, ContextSpot, MapContextMenu } from "./map-context-menu";
import { MapOverlays } from "./map-overlays";
import { Home, homeMarks, requestMarks } from "./marks";
import { HomesPanel } from "./homes-panel";
import { NeedPanel } from "./need-panel";
import { Person, useRescueBoard } from "./use-rescue-board";
import { PlanPanel } from "./plan-panel";
import { RiderUpload } from "./map-tools";
import { useDrawingTools } from "./use-drawing-tools";
import { HouseCard } from "./house-card";
import { PickupLayer } from "./pickup-layer";
import { ReadyPanel } from "./ready-panel";
import { useMapClick, useMapFocus } from "./use-map-focus";
import { usePickups } from "./use-pickups";
import { useSimulatedFire } from "./use-simulated-fire";

const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;

export function RescueMap() {
  const data = useInkMapData();
  const [forecastShown, setForecastShown] = useState(true);
  const control = useQuery(api.control.get);

  const [mode, setMode] = useState<SurfaceMode>("ink");
  const { toLatLng, toLocal } = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }), [data?.origin]);

  const board = useRescueBoard(data, toLocal);
  const { homes, withOpenRequest, highlights, stillHome } = useRoofs(data, board.people, toLocal);
  const { hazard, danger, clock, simulated, ignite } = useFireOnScreen(data, control?.warningIssuedAt, homes, toLocal);
  const mapFocus = useMapFocus(homes, toLocal);
  const pickups = usePickups(toLocal);
  const [vanFocusId, setVanFocusId] = useState<string | null>(null);

  const drawing = useDrawingTools(data, toLatLng);
  const { tool, setTool, startFrom } = drawing;
  const onPick = useMapClick(tool, drawing.pick, mapFocus.pickHome, ignite);
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
        onPick={onPick}
        onHover={drawing.hover}
        onContextPick={(point, screen) => setSpot({ point, screen })}
        focus={mapFocus.flyTarget}
        interactive={tool !== "look"}
        className="absolute inset-0"
        controls={
          <>
            <ZoomControls className="absolute right-[21.75rem] bottom-24" />
            {mapFocus.card && <HouseCard householdId={mapFocus.card.householdId} at={mapFocus.card.point} onClose={mapFocus.closeCard} />}
          </>
        }
        underlay={
          <>
            {danger && forecastShown && <DangerLayer danger={danger} minutes={clock.minutes} />}
            <FireSpreadLayer hazard={hazard} minutes={clock.minutes} />
          </>
        }
      >
        <PickupLayer pickups={pickups} focusHouseholdId={mapFocus.homeEmphasis} />
        <MapOverlays zone={drawing.zone} street={drawing.street} people={board.people} vans={board.vans} focusId={mapFocus.pinFocus} stillHome={stillHome} vanFocusId={vanFocusId} onVanHover={setVanFocusId} />
      </MapStage>

      <PanelDesk storageKey="rescue-map-panels">
        <div className="pointer-events-none absolute inset-0 flex flex-col">
          <MapTopBar issuedAt={control?.warningIssuedAt} />
          <div className="flex min-h-0 flex-1 items-stretch gap-3 p-3">
            <div className="pointer-events-auto flex w-[25rem] max-w-[40vw] shrink-0 flex-col gap-3 overflow-y-auto pr-1">
              <ReadyPanel homes={homes} pickups={pickups} control={control} focus={mapFocus.homeFocus} />
              <HomesPanel homes={homes} withOpenRequest={withOpenRequest} />
              <NeedPanel people={board.people} focus={mapFocus.focusProps} className="shrink" />
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
              {simulated.summary && <SimulatedFireHint summary={simulated.summary} response={simulated.response} onResponse={simulated.setResponse} onClear={simulated.putOut} />}
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

// The scenario's fire, or the one the dispatcher lit at a house to rehearse, which replaces it here
// until it is put out. The forecast is for the scenario's fire, so it is hidden while a lit one burns.
const NO_BUILDINGS: InkMapData["buildings"] = [];

function useFireOnScreen(data: InkMapData | null, warningIssuedAt: number | undefined, homes: Home[], toLocal: (point: LatLng) => Point) {
  const scenario = useHazard(data?.origin);
  const forecast = useDangerZones(data?.origin);
  const simulated = useSimulatedFire(scenario, data?.buildings ?? NO_BUILDINGS, homes, toLocal);
  const hazard = simulated.hazard ?? scenario;
  const clock = useFireClock(hazard, simulated.startedAt ?? warningIssuedAt);
  const { follow } = clock;
  const { ignite: igniteAt, clear: clearFire } = simulated;
  const ignite = useCallback(
    (point: Point) => {
      igniteAt(point);
      follow();
    },
    [igniteAt, follow],
  );
  const putOut = useCallback(() => {
    clearFire();
    follow();
  }, [clearFire, follow]);
  const fire = simulated.hazard;
  const summary = fire ? { burned: fire.burned, outAt: fire.outAt, homesReached: simulated.homesReached } : null;
  return {
    hazard,
    danger: fire ? null : forecast,
    clock,
    simulated: { summary, response: simulated.response, setResponse: simulated.setResponse, putOut },
    ignite,
  };
}
