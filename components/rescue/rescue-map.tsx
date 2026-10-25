"use client";

import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { MapStage } from "@/components/map/map-stage";
import { ZoomControls } from "@/components/map/zoom-controls";
import { PanelDesk } from "@/components/ui/panel-desk";
import { TOWN_FRAME } from "@/components/map/projection";
import { useBuildingHighlights } from "@/components/map/use-highlights";
import { LatLng } from "@/lib/geo";
import { createProjection, InkMapData, Point } from "@/lib/ink-map/data";
import { fireStateAt } from "@/lib/ink-map/fire-field";
import { FORECAST_AHEAD_MINUTES, forecastField, useDangerZones } from "@/lib/ink-map/danger";
import { useFireClock, useHazard } from "@/lib/ink-map/hazard";
import { ForecastControl } from "./danger-zones";
import { DoorCheckPanel, NominationPanel } from "./field-panel";
import { FireCrewEngines, FireCrewTrails } from "./fire-crew-layer";
import { FireCrewPanel } from "./fire-crew-panel";
import { FireSpreadLayer } from "./fire-spread-layer";
import { FleetPanel } from "./fleet-panel";
import { DrawingHint, PlaybackBar, MapToolbar, MapTopBar, SimulatedFireHint } from "./map-chrome";
import { ContextAction, ContextSpot, MapContextMenu } from "./map-context-menu";
import { MapOverlays } from "./map-overlays";
import { Home, homeMarks, requestMarks } from "./marks";
import { HomesPanel } from "./homes-panel";
import { NeedPanel } from "./need-panel";
import { Person, useRescueBoard } from "./use-rescue-board";
import { PlanPanel } from "./plan-panel";
import { RiderUpload } from "./map-tools";
import { useDrawingTools } from "./use-drawing-tools";
import { besidePanels, HouseCard } from "./house-card";
import { PickupLayer } from "./pickup-layer";
import { useFireCrews } from "./use-fire-crews";
import { ReadyPanel } from "./ready-panel";
import { useMapClick, useMapFocus } from "./use-map-focus";
import { usePickups } from "./use-pickups";
import { useSimulatedFire } from "./use-simulated-fire";
import { FireView, skippedCount, unreachedHomes } from "./unreached";
import { UnreachedPanel } from "./unreached-panel";

const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;
// Panels keep their full height and the column scrolls, so no panel is ever cut short.
const PANEL_COLUMN = "pointer-events-auto flex shrink-0 flex-col gap-3 overflow-y-auto [&>*]:shrink-0";
// The house card goes between the two panel columns below when they leave room for it.
const CARD_ROOM = besidePanels({ rem: 25, maxShare: 0.4 }, { rem: 20, maxShare: 0.32 });
// The whole door-check list: the fire crews work all of it, and the panel shows all of it.
const DOOR_QUEUE_LIMIT = 1000;

export function RescueMap() {
  const data = useInkMapData();
  const [forecastShown, setForecastShown] = useState(true);
  const control = useQuery(api.control.get);

  const { toLatLng, toLocal } = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }), [data?.origin]);

  const board = useRescueBoard(data, toLocal);
  const { homes, withOpenRequest, highlights, stillHome: quietHomes } = useRoofs(data, board.people, toLocal);
  const { hazard, danger, clock, simulated } = useFireOnScreen(data, control?.warningIssuedAt, homes, toLocal);
  const { unreached, skipped, stillHome } = useUnreachedHomes({ homes, withOpenRequest, quietHomes, control, fire: { hazard, danger, minutes: clock.minutes }, toLocal });
  const fireAt = useCallback((point: Point) => (hazard ? fireStateAt(hazard.field, point, clock.minutes) : null), [hazard, clock.minutes]);
  // One subscription to the list, so the crews and the Doors to knock panel read the same order.
  const doorQueue = useQuery(api.doorChecks.queue, { limit: DOOR_QUEUE_LIMIT });
  const crews = useFireCrews({ data, homes, queue: doorQueue, hazard, startedAt: clock.startedAt, minutes: clock.minutes, toLocal });
  const forecast = useMemo(() => (danger ? { field: forecastField(danger), aheadMinutes: FORECAST_AHEAD_MINUTES } : null), [danger]);
  const mapFocus = useMapFocus(homes, toLocal);
  const pickups = usePickups(data, toLocal, board.closed);
  const [vanFocusId, setVanFocusId] = useState<string | null>(null);

  const drawing = useDrawingTools(data, toLatLng);
  const { tool, setTool, startFrom } = drawing;
  const onPick = useMapClick(tool, drawing.pick, mapFocus.pickHome);
  const putOutFire = useZoneAroundFire(simulated, drawing);
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
        hazard={hazard}
        minutes={clock.minutes}
        forecast={forecastShown ? forecast : null}
        highlights={highlights}
        onPick={onPick}
        onHover={drawing.hover}
        onContextPick={(point, screen) => setSpot({ point, screen })}
        focus={mapFocus.flyTarget}
        interactive={tool !== "look"}
        className="absolute inset-0"
        controls={
          <>
            <ZoomControls className="absolute right-3 bottom-3" />
            {mapFocus.card && <HouseCard householdId={mapFocus.card.householdId} at={mapFocus.card.point} onClose={mapFocus.closeCard} sideRoom={CARD_ROOM} />}
          </>
        }
        underlay={
          <>
            <FireSpreadLayer hazard={hazard} minutes={clock.minutes} />
          </>
        }
      >
        <PickupLayer pickups={pickups} focusHouseholdId={mapFocus.homeEmphasis} />
        <FireCrewTrails crews={crews} minutes={clock.minutes} />
        <MapOverlays
          zone={drawing.zone}
          street={drawing.street}
          people={board.people}
          vans={board.vans}
          focusId={mapFocus.pinFocus}
          stillHome={stillHome}
          unreached={unreached}
          vanFocusId={vanFocusId}
          onVanHover={setVanFocusId}
          fireAt={fireAt}
        />
        <FireCrewEngines crews={crews} minutes={clock.minutes} />
      </MapStage>

      <PanelDesk storageKey="rescue-map-panels">
        <div className="pointer-events-none absolute inset-0 flex flex-col">
          <MapTopBar issuedAt={control?.warningIssuedAt} />
          <div className="flex min-h-0 flex-1 items-stretch gap-3 p-3">
            <div className={`${PANEL_COLUMN} w-[25rem] max-w-[40vw] pr-1`}>
              <UnreachedPanel unreached={unreached} skipped={skipped} focus={mapFocus.homeFocus} />
              <ReadyPanel homes={homes} pickups={pickups} control={control} focus={mapFocus.homeFocus} />
              <HomesPanel homes={homes} withOpenRequest={withOpenRequest} />
              <NeedPanel people={board.people} unplaced={board.unplaced} focus={mapFocus.focusProps} />
              <NominationPanel />
            </div>
            <div className="min-w-0 flex-1" />
            <div className={`${PANEL_COLUMN} w-[20rem] max-w-[32vw] pl-1`}>
              <FireCrewPanel crews={crews} minutes={clock.minutes} />
              <DoorCheckPanel queue={doorQueue} crews={crews} minutes={clock.minutes} unreached={unreached.length} />
              <PlanPanel />
              <FleetPanel vans={board.vans} onVanHover={setVanFocusId} />
              <RiderUpload />
            </div>
          </div>
          {/* Reverse wrapping flips the cross axis: items-start sits every control on the bottom edge. */}
          <div className="flex flex-wrap-reverse items-start gap-3 p-3 pt-0">
            <MapToolbar tool={tool} onTool={setTool}>
              {simulated.summary && <SimulatedFireHint summary={simulated.summary} response={simulated.response} onResponse={simulated.setResponse} onClear={putOutFire} />}
              <DrawingHint tool={tool} status={drawing.status} zone={drawing.zone} onUndo={drawing.undoCorner} onSave={drawing.saveZone} />
            </MapToolbar>
            <div className="flex min-w-0 grow basis-[36rem] flex-col items-center gap-2">
              <PlaybackBar clock={clock}>
                {danger && <ForecastControl danger={danger} shown={forecastShown} onToggle={() => setForecastShown((shown) => !shown)} />}
              </PlaybackBar>
            </div>
            <div className="w-10 shrink-0" aria-hidden />
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

type UnreachedArgs = {
  homes: Home[];
  withOpenRequest: Set<string>;
  quietHomes: Point[];
  control: ReturnType<typeof useQuery<typeof api.control.get>>;
  fire: FireView;
  toLocal: (point: LatLng) => Point;
};

// After the warning, homes nobody confirmed out with the fire on them or due within the hour. They
// leave the quiet ink squares and get their own red marks, so a glance can't miss them.
function useUnreachedHomes({ homes, withOpenRequest, quietHomes, control, fire, toLocal }: UnreachedArgs) {
  const warned = control?.warningIssuedAt !== undefined;
  const voiceStandIn = control?.simulateVoice ?? true;
  // Once a minute is plenty for a list sorted in minutes, and keeps the forecast's polygon tests off every frame.
  const { hazard, danger } = fire;
  const minutes = Math.floor(fire.minutes);
  const unreached = useMemo(
    () => (warned ? unreachedHomes({ homes, withOpenRequest, fire: { hazard, danger, minutes }, voiceStandIn, toLocal }) : []),
    [warned, homes, withOpenRequest, hazard, danger, minutes, voiceStandIn, toLocal],
  );
  const skipped = useMemo(() => (warned ? skippedCount(homes, voiceStandIn) : 0), [warned, homes, voiceStandIn]);
  const stillHome = useMemo(() => {
    const alarmed = new Set(unreached.map((entry) => `${entry.at[0]},${entry.at[1]}`));
    return quietHomes.filter((at) => !alarmed.has(`${at[0]},${at[1]}`));
  }, [quietHomes, unreached]);
  return { unreached, skipped, stillHome };
}

// The scenario's fire, or the one the dispatcher lit at a house to rehearse, which replaces it here
// until it is put out. The forecast is for the scenario's fire, so it is hidden while a lit one burns.
function useFireOnScreen(data: InkMapData | null, warningIssuedAt: number | undefined, homes: Home[], toLocal: (point: LatLng) => Point) {
  const scenario = useHazard(data?.origin);
  const forecast = useDangerZones(data?.origin);
  const simulated = useSimulatedFire(scenario, data, homes, toLocal);
  const hazard = simulated.hazard ?? scenario;
  const startedAt = simulated.startedAt ?? warningIssuedAt;
  const clock = useFireClock(hazard, startedAt);
  const { ignite, clear: putOut } = simulated;
  const fire = simulated.hazard;
  const summary = fire ? { burned: fire.burnedAt.length, outAt: fire.outAt, homesReached: simulated.homesToWarn } : null;
  return {
    hazard,
    danger: fire ? null : forecast,
    clock: { ...clock, startedAt },
    simulated: { summary, lit: fire !== null, zoneCorners: simulated.zoneCorners, response: simulated.response, setResponse: simulated.setResponse, putOut },
    ignite,
  };
}

// A lit fire comes with a warning zone drawn around the buildings it burns, redrawn whenever the fire
// is re-run. Putting the fire out puts the zone tool down too, which drops the zone if it was never saved.
function useZoneAroundFire(
  { lit, zoneCorners, putOut }: { lit: boolean; zoneCorners: number[] | null; putOut: () => void },
  drawing: ReturnType<typeof useDrawingTools>,
) {
  const { proposeZone, setTool } = drawing;
  useEffect(() => {
    if (lit) proposeZone(zoneCorners);
  }, [lit, zoneCorners, proposeZone]);
  return useCallback(() => {
    putOut();
    setTool("look");
  }, [putOut, setTool]);
}
