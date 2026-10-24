"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { MapStage, SurfaceMode } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { useBuildingHighlights } from "@/components/map/use-highlights";
import { createProjection, Point } from "@/lib/ink-map/data";
import { useFireClock, useHazard } from "@/lib/ink-map/hazard";
import { DoorCheckPanel, NominationPanel } from "./field-panel";
import { FleetPanel } from "./fleet-panel";
import { FireScrubber, MapToolbar, MapTool, MapTopBar } from "./map-chrome";
import { MapOverlays } from "./map-overlays";
import { requestMarks } from "./marks";
import { NeedPanel } from "./need-panel";
import { PlanPanel } from "./plan-panel";
import { RiderUpload } from "./map-tools";

const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;

export function RescueMap() {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const control = useQuery(api.control.get);
  const requests = useQuery(api.requests.open);
  const clock = useFireClock(hazard, control?.warningIssuedAt);

  const [mode, setMode] = useState<SurfaceMode>("ink");
  const [tool, setTool] = useState<MapTool>("look");
  const [draft, setDraft] = useState<Point[]>([]);
  const [status, setStatus] = useState("");

  const setZone = useMutation(api.riders.setZone);
  const addClosures = useMutation(api.roads.addClosures);
  const { toLatLng, toLocal } = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }), [data?.origin]);

  const marks = useMemo(() => requestMarks(requests ?? [], toLocal), [requests, toLocal]);
  const highlights = useBuildingHighlights(data ?? null, marks);

  const cancel = useCallback(() => {
    setDraft([]);
    setTool("look");
  }, []);

  const finish = useCallback(async () => {
    if (tool === "zone" && draft.length >= 3) {
      const covered = await setZone({ polygon: draft.map(toLatLng) });
      setStatus(`Zone saved: ${covered} homes`);
      cancel();
    }
    if (tool === "closure" && draft.length === 2) {
      await addClosures({ closures: [{ path: draft.map(toLatLng), source: "manual" }] });
      setStatus("Road closed");
      cancel();
    }
  }, [tool, draft, setZone, addClosures, toLatLng, cancel]);

  useFinishKeys(finish, cancel);

  const pick = useCallback(
    (point: Point) => {
      setStatus("");
      if (tool === "zone") return setDraft((current) => [...current, point]);
      if (tool === "closure") setDraft((current) => (current.length === 0 ? [point] : [current[0], point]));
    },
    [tool],
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
        onPick={pick}
        interactive={tool !== "look"}
        className="absolute inset-0"
      >
        <MapOverlays tool={tool} draft={draft} />
      </MapStage>

      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <MapTopBar issuedAt={control?.warningIssuedAt} />
        <div className="flex min-h-0 flex-1 items-stretch gap-3 p-3">
          <div className="pointer-events-auto flex w-[25rem] max-w-[40vw] shrink-0 flex-col gap-3 overflow-y-auto pr-1">
            <NeedPanel />
            <NominationPanel />
          </div>
          <div className="min-w-0 flex-1" />
          <div className="pointer-events-auto flex w-[20rem] max-w-[32vw] shrink-0 flex-col gap-3 overflow-y-auto pl-1">
            <PlanPanel />
            <FleetPanel />
            <DoorCheckPanel />
            <RiderUpload />
          </div>
        </div>
        <div className="flex items-end gap-3 p-3 pt-0">
          <MapToolbar tool={tool} mode={mode} onTool={setTool} onMode={setMode}>
            {status}
          </MapToolbar>
          <div className="flex min-w-0 flex-1 justify-center">
            <FireScrubber clock={clock} label={hazard?.label ?? "Waiting for the scenario fire"} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Enter finishes what is being drawn; Escape throws it away.
function useFinishKeys(onFinish: () => void, onCancel: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") onFinish();
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFinish, onCancel]);
}
