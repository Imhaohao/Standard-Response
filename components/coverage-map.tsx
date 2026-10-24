"use client";

import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "@/convex/_generated/api";
import {
  AREA,
  EAST_WEST_STREETS,
  FIRE_FIRST_ARRIVAL_MINUTES,
  FIRE_ORIGIN,
  FIRE_SPREAD_METERS_PER_MINUTE,
  NORTH_SOUTH_STREETS,
} from "@/convex/model";
import { OUTCOMES, outcomeColor } from "@/lib/labels";
import { Section } from "./ui/section";

const WIDTH = 520;
const HEIGHT = 495;
const METERS_PER_PX = 2575 / WIDTH;
const CONTOUR_MINUTES = [60, 90, 120, 150];

const project = (lat: number, lng: number) => ({
  x: ((lng - AREA.west) / (AREA.east - AREA.west)) * WIDTH,
  y: ((AREA.north - lat) / (AREA.north - AREA.south)) * HEIGHT,
});

const origin = project(FIRE_ORIGIN.lat, FIRE_ORIGIN.lng);
const contourRadius = (minutes: number) => ((minutes - FIRE_FIRST_ARRIVAL_MINUTES) * FIRE_SPREAD_METERS_PER_MINUTE) / METERS_PER_PX;

function Streets() {
  return (
    <g stroke="var(--line)" strokeWidth={1.5}>
      {EAST_WEST_STREETS.map((name, i) => {
        const y = HEIGHT - ((i + 0.5) / EAST_WEST_STREETS.length) * HEIGHT;
        return <line key={name} x1={0} x2={WIDTH} y1={y} y2={y} />;
      })}
      {NORTH_SOUTH_STREETS.map((name, i) => {
        const x = ((i + 0.5) / NORTH_SOUTH_STREETS.length) * WIDTH;
        return <line key={name} x1={x} x2={x} y1={0} y2={HEIGHT} />;
      })}
    </g>
  );
}

function FireContours() {
  return (
    <g fill="none">
      {CONTOUR_MINUTES.map((minutes, i) => {
        const r = contourRadius(minutes);
        const labelAngle = (205 * Math.PI) / 180;
        return (
          <g key={minutes}>
            <motion.circle
              cx={origin.x}
              cy={origin.y}
              r={r}
              stroke="var(--signal)"
              strokeOpacity={0.55 - i * 0.1}
              strokeWidth={1.5}
              strokeDasharray="6 6"
              className="animate-dash-flow"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.4, delay: 0.2 * i, ease: [0.22, 1, 0.36, 1] }}
            />
            <text
              x={origin.x + r * Math.cos(labelAngle)}
              y={origin.y - r * Math.sin(labelAngle)}
              className="fill-signal text-[11px] font-semibold"
              textAnchor="middle"
            >
              {minutes / 60 >= 1 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Legend() {
  return (
    <ul className="type-small flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-4 py-3 text-ink-muted">
      {OUTCOMES.map((o) => (
        <li key={o.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: o.colorVar }} aria-hidden />
          {o.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-unknown" aria-hidden />
        No answer yet, size is need estimate
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-0 w-4 border-t-2 border-dashed border-signal" aria-hidden />
        Predicted fire arrival
      </li>
    </ul>
  );
}

export function CoverageMap({ className = "" }: { className?: string }) {
  const homes = useQuery(api.households.coverage);

  return (
    <Section title="Who has been reached" className={className}>
      <div className="relative bg-surface-sunk">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full" role="img" aria-label="Map of simulated households colored by call outcome">
          <Streets />
          <FireContours />
          {homes?.map((home) => {
            const { x, y } = project(home.lat, home.lng);
            const unknown = home.outcome === "unknown";
            const inCall = home.callStatus === "in_call";
            return (
              <g key={home._id}>
                {inCall && <circle cx={x} cy={y} r={5} fill="none" stroke="var(--ink)" strokeWidth={1.5} className="animate-ring-out" />}
                <circle
                  cx={x}
                  cy={y}
                  r={unknown ? 2.5 + home.needProbability * 6 : 4.5}
                  fill={inCall ? "var(--ink)" : outcomeColor(home.outcome)}
                  stroke="var(--surface)"
                  strokeWidth={1}
                  style={{ transition: "r 700ms var(--ease-out-quint), fill 400ms var(--ease-standard)" }}
                />
              </g>
            );
          })}
        </svg>
        {homes?.length === 0 && (
          <p className="type-body absolute inset-0 grid place-items-center text-ink-muted">Homes appear when the warning is issued.</p>
        )}
      </div>
      <Legend />
    </Section>
  );
}
