"use client";

import { Drop, Fire, Hurricane, Person, type Icon } from "@phosphor-icons/react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { motion } from "motion/react";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import usAtlas from "us-atlas/states-albers-10m.json";
import { cameraMove, sceneMove } from "../motion";
import type { Beat } from "../script";
import { Percent } from "../percent";
import { Show } from "../show";
import { DISASTERS, type DisasterKind, type LabelSide } from "./disasters";

// us-atlas ships the states already projected to Albers USA in a 975 by 610 box; points go through
// the same projection so they land on the same ground.
const ATLAS = { width: 975, height: 610 };
const albers = geoAlbersUsa().scale(1300).translate([ATLAS.width / 2, ATLAS.height / 2]);
const topology = usAtlas as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;
const toPath = geoPath();
const NATION = toPath(feature(topology, topology.objects.nation)) ?? "";
const BORDERS = toPath(mesh(topology, topology.objects.states, (a, b) => a !== b)) ?? "";

const SCALE = 1.5;
const MAP_LEFT = (1920 - ATLAS.width * SCALE) / 2;
const MAP_TOP = 120;
// The map opens zoomed in on Altadena, where the last slide left off, and pulls back to the country.
const START_ZOOM = 9;

const ICONS: Record<DisasterKind, Icon> = { fire: Fire, hurricane: Hurricane, flood: Drop };

const placed = DISASTERS.map((disaster) => {
  const [x, y] = albers([disaster.lng, disaster.lat]) ?? [0, 0];
  return { ...disaster, x: MAP_LEFT + x * SCALE, y: MAP_TOP + y * SCALE };
});
const altadena = placed[0];

const MARK_RADIUS = 30;
const LAYOUT: Record<LabelSide, string> = { right: "items-center", left: "flex-row-reverse items-center", below: "flex-col items-start" };

function anchor({ x, y, label }: { x: number; y: number; label: LabelSide }) {
  if (label === "left") return { right: 1920 - x - MARK_RADIUS, top: y - MARK_RADIUS };
  return { left: x - MARK_RADIUS, top: y - MARK_RADIUS };
}

function DisasterMark({ disaster, shown, delay, first }: { disaster: (typeof placed)[number]; shown: boolean; delay: number; first: boolean }) {
  const Glyph = ICONS[disaster.kind];
  return (
    <Show when={shown} delay={delay} rise={10} className={`absolute flex gap-4 ${LAYOUT[disaster.label]}`} style={anchor(disaster)}>
      <span
        className={`flex size-[60px] shrink-0 items-center justify-center rounded-full bg-signal text-on-night ${first ? "shadow-[0_0_0_6px_var(--night),0_0_48px_14px_oklch(0.585_0.215_27/0.55)]" : "shadow-[0_0_0_4px_var(--night)]"}`}
      >
        <Glyph size={32} weight="fill" aria-hidden />
      </span>
      <span className="whitespace-nowrap rounded-xl bg-night/80 px-3 py-1">
        <span className="type-deck-label block">{disaster.name}</span>
        <span className="type-deck-note block text-on-night-muted tabular-nums">{disaster.year}</span>
      </span>
    </Show>
  );
}

function UsMap({ beat }: { beat: Beat }) {
  const shown = beat === "everywhere" || beat === "eighty";
  return (
    <motion.div
      className="absolute inset-0"
      style={{ transformOrigin: `${altadena.x}px ${altadena.y}px` }}
      initial={false}
      animate={{ opacity: shown ? (beat === "eighty" ? 0.25 : 1) : 0, scale: shown ? 1 : START_ZOOM }}
      transition={{ ...cameraMove, opacity: { duration: 0.9 } }}
      aria-hidden
    >
      <svg width={1920} height={1080} className="absolute inset-0">
        <g transform={`translate(${MAP_LEFT} ${MAP_TOP}) scale(${SCALE})`}>
          <path d={NATION} fill="var(--night-raised)" />
          <path d={BORDERS} fill="none" stroke="var(--on-night-muted)" strokeOpacity={0.35} strokeWidth={0.6} />
        </g>
      </svg>
    </motion.div>
  );
}

const PEOPLE = 10;
const LEFT_BEHIND = 8;

function EightyPercent({ shown }: { shown: boolean }) {
  return (
    <>
      <Show when={shown} delay={0.2} className="absolute" style={{ left: 128, top: 250, width: 720 }}>
        <p className="type-deck-figure text-signal">
          80
          <Percent />
        </p>
        <p className="type-deck-lede mt-10">of people with disabilities can’t evacuate right away without difficulty</p>
      </Show>
      <div className="absolute grid grid-cols-5 gap-x-6 gap-y-10" style={{ left: 940, top: 270 }} aria-hidden>
        {Array.from({ length: PEOPLE }, (_, i) => (
          <motion.span
            key={i}
            className={i < LEFT_BEHIND ? "text-signal" : "text-on-night-muted"}
            initial={false}
            animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            transition={{ ...sceneMove, delay: shown ? 0.4 + i * 0.07 : 0 }}
          >
            <Person size={150} weight="fill" />
          </motion.span>
        ))}
      </div>
      <Show when={shown} delay={1.2} className="absolute" style={{ left: 128, bottom: 72 }}>
        <p className="type-deck-note text-on-night-muted">UNISDR global survey of persons with disabilities, 2013</p>
      </Show>
    </>
  );
}

export function UsScene({ beat }: { beat: Beat }) {
  const marking = beat === "everywhere";
  return (
    <>
      <UsMap beat={beat} />
      {placed.map((disaster, i) => (
        <DisasterMark key={disaster.name} disaster={disaster} shown={marking} first={i === 0} delay={i === 0 ? 0.6 : 1.4 + i * 0.16} />
      ))}
      <EightyPercent shown={beat === "eighty"} />
    </>
  );
}
