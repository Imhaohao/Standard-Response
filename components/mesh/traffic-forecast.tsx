"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { GeoLine } from "@/components/map/layers";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Panel, PanelEmpty } from "@/components/ui/panel";
import { SIM_MINUTES_PER_SECOND } from "@/lib/ink-map/hazard";
import { SEGMENTS } from "@/lib/mesh/roads";
import { useNow } from "@/lib/time";
import { Figure, Figures, formatRange } from "./figures";
import { HowItWorks, TechTags } from "./technology";

// The traffic forecast from the Langevin crowd model (lib/crowd/forecast.ts), as the agency sees
// it: the streets expected to slow down over the next hour, drawn as a wide soft ink band (darker
// is slower), and the number of cars on the road, with the range across simulation runs.

const INK = "var(--map-ink)";
// A forecast older than this is shown as stale: the runner has probably stopped.
const STALE_MS = 15 * 60_000;
const SHOWN_STREETS = 5;

export type Forecast = NonNullable<ReturnType<typeof useTrafficForecast>>;

export function useTrafficForecast() {
  return useQuery(api.mesh.trafficForecast);
}

const WINDOW_LABELS = ["Next 15 min", "15–30 min", "30–60 min"];

// The wall-clock time a forecast minute falls on.
const clockAt = (forecast: Forecast, minute: number) =>
  forecast.warningIssuedAt + ((forecast.baseMinute + minute) / SIM_MINUTES_PER_SECOND) * 1000;

const shortClock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Darker is a bigger slowdown, wider is more car-minutes lost on that street.
export function forecastStroke(slowdown: number, weight: number) {
  return { stroke: INK, strokeOpacity: 0.12 + 0.5 * slowdown, strokeWidth: 5 + 9 * weight };
}

export function ForecastStreets({ forecast, windowIndex }: { forecast: Forecast; windowIndex: number }) {
  const span = forecast.windows[windowIndex];
  if (!span) return null;
  const most = Math.max(1, ...span.segments.map((s) => s.lostCarMinutes.median ?? 0));
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {span.segments.map((segment) => {
        const path = SEGMENTS.get(segment.key)?.path;
        if (!path) return null;
        const slowdown = segment.slowdown.median ?? 0;
        const weight = Math.sqrt((segment.lostCarMinutes.median ?? 0) / most);
        return <GeoLine key={segment.key} route={path} {...forecastStroke(slowdown, weight)} />;
      })}
    </g>
  );
}

const CHART = { width: 288, height: 96, left: 34, right: 8, top: 8, bottom: 18 };

function CarsChart({ forecast, windowIndex }: { forecast: Forecast; windowIndex: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = forecast.timeline;
  const top = Math.max(1, ...points.map((p) => p.moving.p95 ?? 0));
  const x = (minute: number) => CHART.left + (minute / forecast.horizonMinutes) * (CHART.width - CHART.left - CHART.right);
  const y = (value: number) => CHART.top + (1 - value / top) * (CHART.height - CHART.top - CHART.bottom);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.minute)},${y(p.moving.median ?? 0)}`).join("");
  const band = [
    ...points.map((p, i) => `${i ? "L" : "M"}${x(p.minute)},${y(p.moving.p95 ?? 0)}`),
    ...[...points].reverse().map((p) => `L${x(p.minute)},${y(p.moving.p5 ?? 0)}`),
    "Z",
  ].join("");
  const span = forecast.windows[windowIndex];
  const shown = hover === null ? null : points[hover];
  const pick = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const minute = (((event.clientX - box.left) / box.width) * CHART.width - CHART.left) / (CHART.width - CHART.left - CHART.right);
    setHover(Math.max(0, Math.min(points.length - 1, Math.round((minute * forecast.horizonMinutes) / 5))));
  };
  return (
    <figure className="px-3 pb-2">
      <figcaption className="type-small flex justify-between text-on-panel-muted">
        <span>Cars on the road</span>
        <span className="tabular-nums text-on-panel">
          {shown ? `${shortClock(clockAt(forecast, shown.minute))}: ${formatRange(shown.moving)}` : "Hover for a time"}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        className="mt-1 block w-full touch-none"
        role="img"
        aria-label={`Cars on the road over the next hour, from ${formatRange(points[0].moving)} now to ${formatRange(points[points.length - 1].moving)}`}
        onPointerMove={pick}
        onPointerLeave={() => setHover(null)}
      >
        {span && <rect x={x(span.from)} y={CHART.top} width={x(span.to) - x(span.from)} height={CHART.height - CHART.top - CHART.bottom} fill="var(--panel-raised)" />}
        <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(0)} y2={y(0)} stroke="var(--on-panel-muted)" strokeOpacity={0.4} />
        <text x={CHART.left - 4} y={y(top) + 4} textAnchor="end" className="type-caption fill-on-panel-muted tabular-nums">{Math.round(top).toLocaleString()}</text>
        <text x={CHART.left - 4} y={y(0)} textAnchor="end" className="type-caption fill-on-panel-muted">0</text>
        {[0, 30, 60].map((minute) => (
          <text key={minute} x={x(minute)} y={CHART.height - 4} textAnchor={minute === 0 ? "start" : minute === 60 ? "end" : "middle"} className="type-caption fill-on-panel-muted tabular-nums">
            {minute === 0 ? "now" : `+${minute} min`}
          </text>
        ))}
        <path d={band} fill="var(--on-panel)" fillOpacity={0.14} />
        <path d={line} fill="none" stroke="var(--on-panel)" strokeWidth={2} strokeLinejoin="round" />
        {shown && (
          <g>
            <line x1={x(shown.minute)} x2={x(shown.minute)} y1={CHART.top} y2={y(0)} stroke="var(--on-panel)" strokeOpacity={0.5} />
            <circle cx={x(shown.minute)} cy={y(shown.moving.median ?? 0)} r={4} fill="var(--on-panel)" stroke="var(--panel)" strokeWidth={2} />
          </g>
        )}
      </svg>
    </figure>
  );
}

const whole = (x: number | null) => (x === null ? "—" : Math.round(x * 100).toString());

function StreetList({ streets }: { streets: Forecast["windows"][number]["streets"] }) {
  if (streets.length === 0) return <PanelEmpty>No street expected to slow down.</PanelEmpty>;
  return (
    <ol className="flex flex-col gap-1.5 border-t border-panel-raised px-3 py-2">
      {streets.slice(0, SHOWN_STREETS).map(({ name, slowdown, cars }) => (
        <li key={name}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="type-small min-w-0 truncate font-semibold">{name}</span>
            <span className="type-small shrink-0 font-semibold tabular-nums">{whole(slowdown.median)}% slower</span>
          </div>
          <div className="type-small flex justify-between gap-3 tabular-nums text-on-panel-muted">
            <span>{formatRange(cars)} cars</span>
            <span>
              {whole(slowdown.p5)} to {whole(slowdown.p95)}%
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ForecastBody({ forecast, windowIndex, onWindow }: { forecast: Forecast; windowIndex: number; onWindow: (index: number) => void }) {
  const now = useNow(30_000);
  const span = forecast.windows[windowIndex];
  const end = forecast.timeline.find((point) => point.minute === span.to) ?? forecast.timeline[forecast.timeline.length - 1];
  const stale = now > 0 && now - forecast.issuedAt > STALE_MS;
  return (
    <>
      <p className={`type-small px-3 ${stale ? "font-semibold text-on-panel" : "text-on-panel-muted"}`}>
        {stale ? `Forecast is ${Math.round((now - forecast.issuedAt) / 60_000)} min old` : `As of ${shortClock(clockAt(forecast, 0))}`}, {forecast.members} runs of the crowd model
      </p>
      <div className="px-3 py-2">
        <SegmentedControl
          ariaLabel="Forecast window"
          value={String(windowIndex)}
          onChange={(value) => onWindow(Number(value))}
          options={forecast.windows.map((w, i) => ({ value: String(i), label: WINDOW_LABELS[i] ?? `${w.from}–${w.to} min` }))}
        />
      </div>
      <StreetList streets={span.streets} />
      <Figures>
        <Figure label={`Cars on the road at ${shortClock(clockAt(forecast, end.minute))}`} value={formatRange(end.moving)} />
        <Figure label="Their average speed, km/h" value={formatRange(end.meanSpeed, 0, 3.6)} />
        <Figure label="Households out of the zone by then" value={formatRange(end.arrived)} />
      </Figures>
      <CarsChart forecast={forecast} windowIndex={windowIndex} />
      <p className="type-small border-t border-panel-raised px-3 py-2 text-on-panel-muted">
        Simulated: {forecast.households.toLocaleString()} synthetic households, {forecast.blockedSegments} known blocked streets held fixed. Not measured traffic.
      </p>
    </>
  );
}

export function TrafficPanel({
  forecast,
  warningIssued,
  windowIndex,
  onWindow,
}: {
  forecast: Forecast | null | undefined;
  warningIssued: boolean;
  windowIndex: number;
  onWindow: (index: number) => void;
}) {
  return (
    <Panel title="Traffic, next hour" className="shrink-0">
      <TechTags uses={["langevin", "departure"]} />
      {forecast === undefined && <PanelEmpty>Loading…</PanelEmpty>}
      {forecast === null && <PanelEmpty>{warningIssued ? "Streets likely to slow down in the next hour show up here a few minutes after the warning. The forecast updates every 5 minutes." : "Forecasts start once a warning goes out."}</PanelEmpty>}
      {forecast && <ForecastBody forecast={forecast} windowIndex={windowIndex} onWindow={onWindow} />}
      <HowItWorks tech="langevin">
        Here: {forecast?.members ?? "Several"} runs of this crowd model follow tonight from the warning. Every 5 minutes each is copied and run an hour ahead, and the
        ranges are the spread across the runs.
      </HowItWorks>
    </Panel>
  );
}
