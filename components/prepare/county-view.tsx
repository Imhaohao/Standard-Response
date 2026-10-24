"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { GeoAnchor, GeoLine } from "@/components/map/layers";
import { ChromeSurface, MapViewControl } from "@/components/map/map-bar";
import { MapStage, SurfaceMode } from "@/components/map/map-stage";
import { Frame, TOWN_FRAME } from "@/components/map/projection";
import { AppBar } from "@/components/ui/app-bar";
import { Panel, PanelEmpty } from "@/components/ui/panel";
import { LatLng } from "@/lib/geo";
import { createProjection, Point } from "@/lib/ink-map/data";
import { ROUND_MASS } from "@/lib/mesh/rounds";
import { AreaShape, areaLabel } from "@/lib/prepare/areas";
import { Estimate, TALLY_ITEMS, TallyItemId } from "@/lib/prepare/tally";
import { oddsRatio, TASK_IDS, TASKS, TaskId } from "@/lib/prepare/tasks";
import { Figure, Figures } from "../mesh/figures";
import { SurveyHowItWorks, SurveyTags } from "./technology";
import { useAreaShapes } from "./use-survey-phone";

const INK = "var(--map-ink)";
// Areas with fewer answers than this are drawn empty: the interval would be too wide to read.
const MIN_ANSWERS = 20;

type Counts = NonNullable<ReturnType<typeof useQuery<typeof api.prepare.counts>>>;

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

function centroid(shape: AreaShape) {
  const ring = shape.rings[0] ?? [];
  const lat = ring.reduce((s, p) => s + p.lat, 0) / Math.max(ring.length, 1);
  const lng = ring.reduce((s, p) => s + p.lng, 0) / Math.max(ring.length, 1);
  return { lat, lng };
}

// The block groups reach west and north of the town frame, so the map is framed on them instead:
// both the 3D and the flat view then show every block group the counts cover.
function areasFrame(shapes: AreaShape[], toLocal: (point: LatLng) => Point): Frame {
  const points = shapes.flatMap((shape) => shape.rings.flat().map(toLocal));
  if (!points.length) return TOWN_FRAME;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Each block group's tone is its estimated share; the darkest is the highest share on the map.
function AreaShading({ shapes, counts, item, selected }: { shapes: AreaShape[]; counts: Counts | undefined; item: TallyItemId; selected: string | null }) {
  const byId = new Map<string, Estimate>(counts?.areas.map((a) => [a.id, a.estimates[item]]) ?? []);
  const top = Math.max(0.05, ...[...byId.values()].map((e) => (e.answered >= MIN_ANSWERS ? (e.share ?? 0) : 0)));
  return (
    <g>
      {shapes.map((shape) => {
        const estimate = byId.get(shape.id);
        const readable = estimate && estimate.answered >= MIN_ANSWERS && estimate.share !== null;
        const tone = readable ? 0.06 + 0.5 * (estimate.share! / top) : 0;
        return shape.rings.map((ring, i) => (
          <GeoLine
            key={`${shape.id}-${i}`}
            route={ring}
            close
            fill={INK}
            fillOpacity={tone}
            stroke={INK}
            strokeOpacity={shape.id === selected ? 0.95 : 0.35}
            strokeWidth={shape.id === selected ? 3 : 1}
          />
        ));
      })}
      {shapes.map((shape) => {
        const estimate = byId.get(shape.id);
        if (!estimate || estimate.answered < MIN_ANSWERS) return null;
        return (
          <GeoAnchor key={shape.id} at={centroid(shape)}>
            <text textAnchor="middle" dominantBaseline="middle" className="type-small" fill={INK} stroke="var(--map-paper)" strokeWidth={3} paintOrder="stroke" fontWeight={700}>
              {pct(estimate.share)}
            </text>
          </GeoAnchor>
        );
      })}
    </g>
  );
}

function Interval({ estimate }: { estimate: Estimate }) {
  if (estimate.share === null) return <span className="type-small text-on-panel-muted">no answers</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-2 w-20 shrink-0 bg-panel-raised" aria-hidden>
        <span className="absolute inset-y-0 bg-on-panel/30" style={{ left: `${estimate.low! * 100}%`, width: `${(estimate.high! - estimate.low!) * 100}%` }} />
        <span className="absolute inset-y-[-2px] w-0.5 bg-on-panel" style={{ left: `${estimate.share * 100}%` }} />
      </span>
      <span className="type-small w-24 shrink-0 text-right font-semibold tabular-nums">
        {pct(estimate.share)} <span className="font-normal text-on-panel-muted">±{Math.round(((estimate.high! - estimate.low!) / 2) * 100)}</span>
      </span>
    </span>
  );
}

function CountsPanel({ counts, item, onItem, selected, onSelect }: { counts: Counts | undefined; item: TallyItemId; onItem: (item: TallyItemId) => void; selected: string | null; onSelect: (id: string | null) => void }) {
  if (!counts) return <Panel title="What households told us"><PanelEmpty>Loading…</PanelEmpty></Panel>;
  const areas = [...counts.areas].filter((a) => a.estimates[item].answered >= MIN_ANSWERS).sort((a, b) => (b.estimates[item].share ?? 0) - (a.estimates[item].share ?? 0));
  return (
    <Panel title="What households told us">
      <SurveyTags uses={["randomized", "mixing"]} />
      {counts.households === 0 ? (
        <PanelEmpty>Nothing uploaded yet. Counts appear once a gateway uploads mixes of five or more households.</PanelEmpty>
      ) : (
        <>
          <ul className="flex flex-col border-t border-panel-raised py-1">
            {TALLY_ITEMS.map(({ id, label }) => (
              <li key={id}>
                <button type="button" aria-pressed={id === item} onClick={() => onItem(id)} className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left ${id === item ? "bg-panel-raised" : "hover:bg-panel-raised/50"}`}>
                  <span className="type-small min-w-0 font-semibold">{label}</span>
                  <Interval estimate={counts.town[id]} />
                </button>
              </li>
            ))}
          </ul>
          <p className="type-small border-t border-panel-raised px-3 pt-2 pb-1 text-on-panel-muted">Town share with its 95% interval. By block group, highest first:</p>
          <ul className="flex flex-col pb-2">
            {areas.map((area) => (
              <li key={area.id}>
                <button type="button" onClick={() => onSelect(area.id === selected ? null : area.id)} className={`flex w-full items-center justify-between gap-3 px-3 py-1 text-left ${area.id === selected ? "bg-panel-raised" : "hover:bg-panel-raised/50"}`}>
                  <span className="type-small min-w-0 truncate">{areaLabel(area.id)}</span>
                  <Interval estimate={area.estimates[item]} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <SurveyHowItWorks tech="randomized">Here: every share is worked out from coin-flipped answers, so no single household&apos;s answer is known.</SurveyHowItWorks>
    </Panel>
  );
}

function AreaPanel({ counts, area }: { counts: Counts | undefined; area: string }) {
  const estimates = counts?.areas.find((a) => a.id === area)?.estimates;
  if (!estimates) return null;
  return (
    <Panel title={areaLabel(area)}>
      <dl className="flex flex-col gap-1 px-3 pb-3">
        {TALLY_ITEMS.map(({ id, label }) => (
          <div key={id} className="flex items-center justify-between gap-3">
            <dt className="type-small min-w-0 text-on-panel-muted">
              {label}
              <span className="type-caption block">{Math.round(estimates[id].answered)} answered</span>
            </dt>
            <dd>
              <Interval estimate={estimates[id]} />
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

type History = NonNullable<ReturnType<typeof useQuery<typeof api.prepare.history>>>;

function ModelCard({ task, history }: { task: TaskId; history: History[number] | undefined }) {
  const latest = history?.versions[0];
  const open = history?.open;
  const spec = TASKS[task];
  return (
    <div className="flex flex-col border-t border-panel-raised">
      <h3 className="type-small px-3 pt-2 font-bold">{spec.title}</h3>
      <Figures>
        <Figure label="Version" value={latest?.version ?? 0} />
        <Figure label="Households' worth of updates in it" value={Math.round(latest?.contributors ?? 0)} />
        <Figure label="Next version" value={`${(open && open.baseVersion === (latest?.version ?? 0) ? open.mass : 0).toFixed(1)} of ${ROUND_MASS}`} />
      </Figures>
      {latest && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 px-3 pb-2">
          <dt className="type-small pb-0.5 text-on-panel-muted">Odds change for one spread of</dt>
          <dd className="type-small text-right text-on-panel-muted">×</dd>
          {spec.featureNames.slice(1).map((name, i) => (
            <div key={name} className="contents">
              <dt className="type-small text-on-panel-muted">{name}</dt>
              <dd className="type-small text-right font-semibold tabular-nums">{oddsRatio(latest.weights[i + 1]).toFixed(2)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ModelsPanel() {
  const history = useQuery(api.prepare.history);
  return (
    <Panel title="Shared models" className="shrink-0">
      <SurveyTags uses={["federated"]} />
      {TASK_IDS.map((task) => (
        <ModelCard key={task} task={task} history={history?.find((h) => h.task === task)} />
      ))}
      <SurveyHowItWorks tech="federated">Here: the models households trained without sending their answers. Phones use them to show each home its own risk.</SurveyHowItWorks>
    </Panel>
  );
}

function UploadsPanel({ counts }: { counts: Counts | undefined }) {
  return (
    <Panel title="Uploads" className="shrink-0">
      <Figures>
        <Figure label="Households' worth received" value={Math.round(counts?.households ?? 0)} hint="Counted once per topic a household shared" />
        <Figure label="Uploads" value={counts?.uploads ?? 0} hint="Each a mix of five or more" />
        <Figure label="Refused" value={counts?.refused ?? 0} hint="Too small, malformed or out of bounds" />
      </Figures>
      <p className="type-small border-t border-panel-raised px-3 py-2 text-on-panel-muted">No answer, phone, person or uploader is ever received or stored.</p>
    </Panel>
  );
}

export function CountyView() {
  const data = useInkMapData();
  const shapes = useAreaShapes();
  const counts = useQuery(api.prepare.counts);
  const [item, setItem] = useState<TallyItemId>("cantAffordWeek");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<SurfaceMode>("paper");
  const itemLabel = useMemo(() => TALLY_ITEMS.find((i) => i.id === item)?.label ?? "", [item]);
  const origin = data?.origin;
  const view = useMemo(() => (origin && shapes ? { kind: "overview" as const, fit: areasFrame(shapes, createProjection(origin).toLocal) } : null), [origin, shapes]);

  // The 3D map is rebuilt whenever its framing changes, so it waits for the block groups it frames.
  if (!data || !view) return <p className="type-body grid h-[100dvh] place-items-center text-ink-muted">Loading the map of Altadena…</p>;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-map-paper">
      <MapStage data={data} view={view} mode={mode} className="absolute inset-0">
        {shapes && <AreaShading shapes={shapes} counts={counts} item={item} selected={selected} />}
      </MapStage>
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <AppBar>
          <Link href="/prepare" className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
            A household&apos;s phone
          </Link>
        </AppBar>
        <div className="flex min-h-0 flex-1 items-start justify-between gap-3 p-3">
          <div className="pointer-events-auto flex max-h-full w-[22rem] max-w-[46vw] flex-col gap-3 overflow-y-auto">
            <CountsPanel counts={counts} item={item} onItem={setItem} selected={selected} onSelect={setSelected} />
          </div>
          <div className="pointer-events-auto flex max-h-full w-[20rem] max-w-[44vw] flex-col gap-3 overflow-y-auto">
            {selected && <AreaPanel counts={counts} area={selected} />}
            <ModelsPanel />
            <UploadsPanel counts={counts} />
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-3 self-start p-3">
          <ChromeSurface className="flex items-center gap-3 py-1.5 pr-1.5 pl-3">
            <span className="type-small">
              Darker block group: more households say &ldquo;{itemLabel.toLowerCase()}&rdquo;. Empty: fewer than {MIN_ANSWERS} answers.
            </span>
            <MapViewControl mode={mode} onMode={setMode} />
          </ChromeSurface>
        </div>
      </div>
    </div>
  );
}
