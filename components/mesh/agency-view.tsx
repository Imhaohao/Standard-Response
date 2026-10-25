"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { GeoLine } from "@/components/map/layers";
import { ChromeSurface, MapViewControl } from "@/components/map/map-bar";
import { MapStage, SurfaceMode } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { AppBar } from "@/components/ui/app-bar";
import { Panel, PanelEmpty } from "@/components/ui/panel";
import { ScenarioGeoJson } from "@/lib/ink-map/fire-field";
import { SIM_MINUTES_PER_SECOND, useFireClock, useHazard } from "@/lib/ink-map/hazard";
import { FEATURE_NAMES, predict } from "@/lib/mesh/federated";
import { SEGMENT_INDEX, SEGMENT_LIST, SEGMENTS } from "@/lib/mesh/roads";
import { ROUND_MASS } from "@/lib/mesh/rounds";
import { segmentFireMinutes, streetFeatures } from "@/lib/mesh/street-features";
import { formatClock, useNow } from "@/lib/time";
import { useSimNow } from "@/lib/use-sim-now";
import { Figure, Figures } from "./figures";
import { HowItWorks, TechTags } from "./technology";
import { KeyEntry, KeyLine, MapKey } from "./map-key";
import { ForecastStreets, forecastStroke, TrafficPanel, useTrafficForecast } from "./traffic-forecast";

const INK = "var(--map-ink)";
const PAPER = "var(--map-paper)";
const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;
// Panels keep their full height and the column scrolls; the gaps between them let the map be dragged.
const PANEL_COLUMN = "pointer-events-none flex flex-col gap-3 overflow-y-auto *:pointer-events-auto *:shrink-0";

// Streets the shared model rates at least this likely to be blocked are drawn as estimates.
const ESTIMATE_THRESHOLD = 0.5;

const BLOCKED_HALO = { stroke: PAPER, strokeWidth: 7 };
const BLOCKED = { stroke: INK, strokeWidth: 5, strokeDasharray: "3 2" };
const OPEN = { stroke: INK, strokeWidth: 2.5 };
const ESTIMATE = { stroke: INK, strokeWidth: 3, strokeDasharray: "1 3", strokeLinecap: "round" } as const;
const estimateOpacity = (probability: number) => 0.25 + 0.6 * probability;

type Roads = NonNullable<ReturnType<typeof useRoads>>;

function useRoads() {
  const now = useNow(60_000);
  const minute = Math.floor(now / 60_000) * 60_000;
  return useQuery(api.mesh.roads, minute ? { now: minute } : "skip");
}

function useFireMinutes() {
  const [fire, setFire] = useState<Float64Array | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/scenario")
      .then((r) => r.json() as Promise<ScenarioGeoJson | null>)
      .then((scenario) => live && setFire(segmentFireMinutes(scenario)));
    return () => {
      live = false;
    };
  }, []);
  return fire;
}

// Where the shared model expects blockages that nobody has reported yet.
function useEstimates(roads: Roads | undefined, weights: number[] | undefined, issuedAt: number | undefined) {
  const fire = useFireMinutes();
  const now = useSimNow(60_000);
  return useMemo(() => {
    if (!fire || !weights || !roads || !now) return [];
    const minutes = issuedAt === undefined ? 0 : ((now - issuedAt) / 1000) * SIM_MINUTES_PER_SECOND;
    const reported = new Set(roads.segments.map((s) => s.segment));
    const blocked = new Set(roads.segments.filter((s) => s.status === "blocked").map((s) => SEGMENT_INDEX.get(s.segment)));
    const estimates: { index: number; probability: number }[] = [];
    SEGMENT_LIST.forEach((segment, index) => {
      if (reported.has(segment.key)) return;
      const probability = predict(weights, streetFeatures(index, minutes, fire, (s) => blocked.has(s)));
      if (probability >= ESTIMATE_THRESHOLD) estimates.push({ index, probability });
    });
    return estimates;
  }, [fire, weights, roads, now, issuedAt]);
}

function ReportedStreets({ roads }: { roads: Roads }) {
  return (
    <g fill="none">
      {roads.segments.map((s) => {
        const path = SEGMENTS.get(s.segment)?.path ?? [];
        if (s.status === "blocked")
          return (
            <g key={s.segment}>
              <GeoLine route={path} {...BLOCKED_HALO} />
              <GeoLine route={path} {...BLOCKED} />
            </g>
          );
        return s.status === "clear" ? <GeoLine key={s.segment} route={path} {...OPEN} /> : null;
      })}
    </g>
  );
}

function EstimatedStreets({ estimates }: { estimates: { index: number; probability: number }[] }) {
  return (
    <g fill="none">
      {estimates.map(({ index, probability }) => (
        <GeoLine key={index} route={SEGMENT_LIST[index].path} {...ESTIMATE} strokeOpacity={estimateOpacity(probability)} />
      ))}
    </g>
  );
}

// The forecast band runs light to dark, the way a street reads as its slowdown grows.
const FORECAST_SAMPLE = [
  { x1: 2, x2: 12, slowdown: 0.2, weight: 0 },
  { x1: 12, x2: 22, slowdown: 0.6, weight: 0.3 },
  { x1: 22, x2: 30, slowdown: 1, weight: 0.6 },
];

function AgencyMapKey() {
  return (
    <MapKey>
      <KeyEntry
        sample={
          <>
            <KeyLine {...BLOCKED_HALO} />
            <KeyLine {...BLOCKED} />
          </>
        }
      >
        Reported blocked
      </KeyEntry>
      <KeyEntry sample={<KeyLine {...OPEN} />}>Reported open</KeyEntry>
      <KeyEntry sample={<KeyLine {...ESTIMATE} strokeOpacity={estimateOpacity(0.75)} />}>Likely blocked, unreported</KeyEntry>
      <KeyEntry
        sample={FORECAST_SAMPLE.map(({ x1, x2, slowdown, weight }) => (
          <KeyLine key={x1} x1={x1} x2={x2} {...forecastStroke(slowdown, weight)} />
        ))}
      >
        Slow traffic, next hour
      </KeyEntry>
    </MapKey>
  );
}

function UploadsPanel({ roads }: { roads: Roads | undefined }) {
  if (!roads) return <Panel title="Road reports from phones"><PanelEmpty>Loading…</PanelEmpty></Panel>;
  const blocked = roads.segments.filter((s) => s.status === "blocked").length;
  const open = roads.segments.filter((s) => s.status === "clear").length;
  const latest = Math.max(0, ...roads.segments.map((s) => s.lastObservedAt));
  return (
    <Panel title="Road reports from phones">
      <TechTags uses={["mesh"]} />
      <Figures>
        <Figure label="Reports, last six hours" value={roads.reports} />
        <Figure label="Relayed phone to phone before upload" value={roads.reports ? `${Math.round((roads.relayed / roads.reports) * 100)}%` : "—"} />
        <Figure label="Streets reported blocked" value={blocked} />
        <Figure label="Streets reported open" value={open} />
        <Figure label="Latest observation" value={latest ? formatClock(latest) : "—"} />
      </Figures>
      <p className="type-small border-t border-panel-raised px-3 py-2 text-on-panel-muted">
        Each report is a street, blocked or open, and the minute. No phone, person or uploader is recorded.
      </p>
      <HowItWorks tech="mesh">Here: the reports phones carried out of the zone. Heavy broken lines on the map are streets they say are blocked.</HowItWorks>
    </Panel>
  );
}

function ModelPanel() {
  const rounds = useQuery(api.mesh.rounds);
  const latest = rounds?.models[0];
  const open = rounds?.open;
  return (
    <Panel title="Shared model" className="shrink-0">
      <TechTags uses={["federated"]} />
      <Figures>
        <Figure label="Version" value={latest?.version ?? 0} />
        <Figure label="Phones' worth of updates in it" value={Math.round(latest?.contributors ?? 0)} />
        <Figure
          label="Next version"
          value={open && open.baseVersion === (latest?.version ?? 0) ? `${open.mass.toFixed(1)} of ${ROUND_MASS}` : `0 of ${ROUND_MASS}`}
          hint="Uploads arrive mixed, five or more phones each"
        />
        {open && open.refused > 0 && <Figure label="Uploads refused" value={open.refused} hint="Too small, too stale, or out of bounds" />}
      </Figures>
      {latest && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-panel-raised px-3 py-2">
          {FEATURE_NAMES.map((name, i) => (
            <div key={name} className="contents">
              <dt className="type-small text-on-panel-muted">{name.replaceAll("_", " ")}</dt>
              <dd className="type-small text-right font-semibold tabular-nums">{latest.weights[i].toFixed(2)}</dd>
            </div>
          ))}
        </dl>
      )}
      <HowItWorks tech="federated">Here: the model the phones trained. Dotted streets on the map are where it expects blockages nobody has reported.</HowItWorks>
    </Panel>
  );
}

export function AgencyView() {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const control = useQuery(api.control.get);
  const clock = useFireClock(hazard, control?.warningIssuedAt);
  const roads = useRoads();
  const model = useQuery(api.mesh.model);
  const estimates = useEstimates(roads, model?.weights, control?.warningIssuedAt);
  const [mode, setMode] = useState<SurfaceMode>("ink");
  const forecast = useTrafficForecast();
  const [forecastWindow, setForecastWindow] = useState(0);

  if (!data) return <p className="type-body grid h-[100dvh] place-items-center text-ink-muted">Loading the map of Altadena…</p>;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-map-paper">
      <MapStage data={data} view={VIEW} mode={mode} hazard={hazard} minutes={clock.minutes} className="absolute inset-0">
        {forecast && <ForecastStreets forecast={forecast} windowIndex={forecastWindow} />}
        {model && model.version > 0 && <EstimatedStreets estimates={estimates} />}
        {roads && <ReportedStreets roads={roads} />}
      </MapStage>
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <AppBar>
          <Link href="/mesh" className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
            A resident&apos;s phone
          </Link>
          <Link href="/flow" className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
            Simulated night
          </Link>
        </AppBar>
        <div className="flex min-h-0 flex-1 items-stretch justify-between gap-3 p-3">
          <div className={`w-[20rem] max-w-[44vw] ${PANEL_COLUMN}`}>
            <UploadsPanel roads={roads} />
          </div>
          <div className={`w-[20rem] max-w-[44vw] ${PANEL_COLUMN}`}>
            <TrafficPanel forecast={forecast} warningIssued={control?.warningIssuedAt !== undefined} windowIndex={forecastWindow} onWindow={setForecastWindow} />
            <ModelPanel />
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-3 self-start p-3">
          <ChromeSurface className="flex items-center gap-3 py-1.5 pr-1.5 pl-3">
            <AgencyMapKey />
            <MapViewControl mode={mode} onMode={setMode} />
          </ChromeSurface>
        </div>
      </div>
    </div>
  );
}
