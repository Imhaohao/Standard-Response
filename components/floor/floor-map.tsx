"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AREA } from "@/convex/model";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { GeoAnchor } from "@/components/map/layers";
import { MapStage } from "@/components/map/map-stage";
import { ZoomControls } from "@/components/map/zoom-controls";
import { NeedMark, useBuildingHighlights } from "@/components/map/use-highlights";
import { createProjection, InkMapData, Point } from "@/lib/ink-map/data";
import { useFireClock, useHazard } from "@/lib/ink-map/hazard";
import { besidePanels, HouseCard, nearestHome } from "@/components/rescue/house-card";
import { HomeKind, homeKind, HomeMark, MAP_TONE } from "./household-mark";

type Home = FunctionReturnType<typeof api.households.coverage>[number];

const INK = MAP_TONE.ink;
const PAPER = MAP_TONE.paper;
const LABEL = { fill: INK, stroke: PAPER, strokeWidth: 3.5, paintOrder: "stroke" as const, fontSize: 12, fontWeight: 800 };

// Panels cover both sides of the floor, so the frame is the calling area with room either side.
const SIDE_ROOM = 0.62;
const TOP_ROOM = 0.04;

function useAreaView(data: InkMapData | null) {
  return useMemo(() => {
    if (!data) return null;
    const { toLocal } = createProjection(data.origin);
    const [x0, y0] = toLocal({ lat: AREA.south, lng: AREA.west });
    const [x1, y1] = toLocal({ lat: AREA.north, lng: AREA.east });
    const width = x1 - x0;
    const height = y1 - y0;
    return {
      kind: "overview" as const,
      fit: { x0: x0 - width * SIDE_ROOM, y0: y0 - height * TOP_ROOM, x1: x1 + width * SIDE_ROOM, y1: y1 + height * TOP_ROOM },
    };
  }, [data]);
}

const ROOF_LEVEL: Partial<Record<HomeKind, number>> = { needs_accessible: 0.95, needs_ride: 0.7 };

function useRedRoofs(data: InkMapData | null, homes: Home[]) {
  const marks = useMemo<NeedMark[]>(() => {
    if (!data) return [];
    const { toLocal } = createProjection(data.origin);
    return homes.flatMap((home) => {
      const level = ROOF_LEVEL[homeKind(home)];
      return level ? [{ point: toLocal(home), level }] : [];
    });
  }, [data, homes]);
  return useBuildingHighlights(data, marks);
}

// Clicking a home opens the same house card as the rescue map, so it can be read and edited here too.
function usePickedHome(data: InkMapData | null, homes: Home[]) {
  const [picked, setPicked] = useState<{ householdId: string; point: Point } | null>(null);
  const pick = useCallback(
    (point: Point) => {
      if (!data) return;
      const { toLocal } = createProjection(data.origin);
      const home = nearestHome(homes, point, toLocal);
      setPicked(home ? { householdId: home._id, point: toLocal(home) } : null);
    },
    [data, homes],
  );
  const close = useCallback(() => setPicked(null), []);
  return { picked, pick, close };
}

const markRadius = (home: Home, kind: HomeKind) => (kind === "waiting" ? 2.6 + home.needProbability * 3.4 : 4.5);

function HomeMarks({ homes }: { homes: Home[] }) {
  return (
    <>
      {homes.map((home) => {
        const kind = homeKind(home);
        return (
          <GeoAnchor key={home._id} at={home}>
            {kind === "on_phone" && <circle r={6} fill="none" stroke={INK} strokeWidth={1.5} className="animate-ring-out" />}
            <HomeMark kind={kind} r={markRadius(home, kind)} tone={MAP_TONE} />
          </GeoAnchor>
        );
      })}
    </>
  );
}

// The dialer's next few homes, numbered on their roofs in the order they will ring.
function QueueFlags({ homeById }: { homeById: Map<Id<"households">, Home> }) {
  const queue = useQuery(api.households.queue, { limit: 6 });
  return (
    <>
      {queue?.map((entry, index) => {
        const home = homeById.get(entry._id);
        if (!home) return null;
        return (
          <GeoAnchor key={entry._id} at={home}>
            <line x1={0} y1={-4} x2={0} y2={-16} stroke={INK} strokeWidth={1.5} />
            <g transform="translate(0 -24)">
              <rect x={-8} y={-8} width={16} height={16} fill={INK} stroke={PAPER} strokeWidth={2} />
              <text textAnchor="middle" y={4} fill={PAPER} fontSize={11} fontWeight={800}>
                {index + 1}
              </text>
            </g>
          </GeoAnchor>
        );
      })}
    </>
  );
}

function Followed({ home, address }: { home: Home; address: string }) {
  return (
    <GeoAnchor at={home}>
      <circle r={13} fill="none" stroke={PAPER} strokeWidth={5} />
      <circle r={13} fill="none" stroke={INK} strokeWidth={2.5} />
      <text x={19} y={4} {...LABEL}>
        {address}
      </text>
    </GeoAnchor>
  );
}

// The work column always covers the left of the floor, and the listening panel the right while it is open.
const WORK_COLUMN = { rem: 23, maxShare: 0.4 };
const LISTENING_PANEL = { rem: 27, maxShare: 0.4 };
const floorSideRoom = (listening: boolean) => besidePanels(WORK_COLUMN, listening ? LISTENING_PANEL : null);

// Docked in the corner of the map the operator can see: left of the listening panel while it is open.
const ZOOM_BESIDE_PANEL = "absolute right-[calc(min(27rem,40vw)+1.5rem)] bottom-3";
const ZOOM_IN_CORNER = "absolute right-3 bottom-3";

// The calling area on the real map. Every simulated household is a mark on its own roof, so the map
// is the reach chart: red where someone needs a ride, ink where the agents are still working.
export function FloorMap({
  followed,
  listeningPanelOpen,
}: {
  followed: { householdId: Id<"households">; address: string } | null;
  listeningPanelOpen?: boolean;
}) {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const control = useQuery(api.control.get);
  const clock = useFireClock(hazard, control?.warningIssuedAt);
  const homes = useQuery(api.households.coverage);
  const view = useAreaView(data);
  const highlights = useRedRoofs(data, homes ?? EMPTY);
  const homeById = useMemo(() => new Map((homes ?? []).map((home) => [home._id, home])), [homes]);
  const followedHome = followed ? homeById.get(followed.householdId) : undefined;
  const besidePanel = listeningPanelOpen ?? false;
  const { picked, pick, close } = usePickedHome(data, homes ?? EMPTY);

  if (!data || !view) return <div className="absolute inset-0 bg-map-paper" aria-hidden />;

  return (
    <MapStage
      data={data}
      view={view}
      hazard={hazard}
      minutes={clock.minutes}
      highlights={highlights}
      onPick={pick}
      className="absolute inset-0"
      controls={
        <>
          <ZoomControls className={besidePanel ? ZOOM_BESIDE_PANEL : ZOOM_IN_CORNER} />
          {picked && <HouseCard key={picked.householdId} householdId={picked.householdId} at={picked.point} onClose={close} sideRoom={floorSideRoom(besidePanel)} />}
        </>
      }
    >
      <HomeMarks homes={homes ?? EMPTY} />
      <QueueFlags homeById={homeById} />
      {followed && followedHome && <Followed home={followedHome} address={followed.address} />}
    </MapStage>
  );
}

const EMPTY: Home[] = [];
