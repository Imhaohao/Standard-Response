"use client";

import { FireSimple } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { MapStage } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { FireSpreadLayer } from "@/components/rescue/fire-spread-layer";
import { useFireClock, useHazard } from "@/lib/ink-map/hazard";

const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;

function NoFire() {
  return (
    <p className="type-body flex items-center gap-2.5 rounded-2xl bg-surface p-4 shadow-inset-line">
      <FireSimple weight="bold" className="size-6 shrink-0 text-ink-muted" aria-hidden />
      There&apos;s no fire right now.
    </p>
  );
}

// The rescue map's fire, burning on the night's clock, without the vans and crews driving over it.
function FireMap({ issuedAt }: { issuedAt: number }) {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const { minutes } = useFireClock(hazard, issuedAt);
  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-map-paper shadow-inset-line">
      {data && <MapStage data={data} view={VIEW} hazard={hazard} minutes={minutes} underlay={<FireSpreadLayer hazard={hazard} minutes={minutes} />} className="absolute inset-0" />}
    </div>
  );
}

// The fire on the judge's phone: a plain line before the warning, the live fire map after it.
export function FireStatus() {
  const control = useQuery(api.control.get);
  if (control === undefined) return null;
  if (control.warningIssuedAt === undefined) return <NoFire />;
  return <FireMap issuedAt={control.warningIssuedAt} />;
}
