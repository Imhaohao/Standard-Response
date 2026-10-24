"use client";

import { motion } from "motion/react";
import {
  EAST_WEST_STREETS,
  FIRE_FIRST_ARRIVAL_MINUTES,
  FIRE_ORIGIN,
  FIRE_SPREAD_METERS_PER_MINUTE,
  NORTH_SOUTH_STREETS,
} from "@/convex/model";
import { MAP_HEIGHT, MAP_WIDTH, METERS_PER_PX, project } from "@/lib/geo";

const CONTOUR_MINUTES = [60, 90, 120, 150];

export function Streets() {
  return (
    <g stroke="var(--line)" strokeWidth={1.5}>
      {EAST_WEST_STREETS.map((name, i) => {
        const y = MAP_HEIGHT - ((i + 0.5) / EAST_WEST_STREETS.length) * MAP_HEIGHT;
        return <line key={name} x1={0} x2={MAP_WIDTH} y1={y} y2={y} />;
      })}
      {NORTH_SOUTH_STREETS.map((name, i) => {
        const x = ((i + 0.5) / NORTH_SOUTH_STREETS.length) * MAP_WIDTH;
        return <line key={name} x1={x} x2={x} y1={0} y2={MAP_HEIGHT} />;
      })}
    </g>
  );
}

const contourRadius = (minutes: number) =>
  ((minutes - FIRE_FIRST_ARRIVAL_MINUTES) * FIRE_SPREAD_METERS_PER_MINUTE) / METERS_PER_PX;

const contourLabel = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;

// Stand-in fire from convex/model.ts. Track D's scenario polygons replace it.
export function FireContours() {
  const origin = project(FIRE_ORIGIN);
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
              {contourLabel(minutes)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
