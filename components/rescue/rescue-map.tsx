"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { PageShell } from "../page-shell";
import { Section } from "../ui/section";
import { DispatchList } from "./dispatch-list";
import { DoorCheckQueue, Nominations } from "./field-lists";
import { MapTool, MapView } from "./map-view";
import { MapTools, RiderUpload } from "./map-tools";
import { PlanSummary } from "./plan-summary";

export function RescueMap() {
  const [tool, setTool] = useState<MapTool>("look");
  const [draft, setDraft] = useState<LatLng[]>([]);
  const addClosures = useMutation(api.roads.addClosures);

  const onPick = (point: LatLng) => {
    if (tool === "zone") return setDraft([...draft, point]);
    if (draft.length === 0) return setDraft([point]);
    void addClosures({ closures: [{ path: [draft[0], point], source: "manual" }] });
    setDraft([]);
    setTool("look");
  };

  return (
    <PageShell>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
          <Section title="Rescue map">
            <MapTools tool={tool} draft={draft} onTool={setTool} onClearDraft={() => setDraft([])} />
            <MapView tool={tool} draft={draft} onPick={onPick} />
            <RiderUpload />
          </Section>
          <div className="grid gap-4 md:grid-cols-2 md:items-start">
            <DoorCheckQueue />
            <Nominations />
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-4 lg:col-span-5">
          <PlanSummary />
          <DispatchList />
        </aside>
      </div>
    </PageShell>
  );
}
