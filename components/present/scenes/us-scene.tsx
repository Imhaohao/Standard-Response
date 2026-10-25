"use client";

import { Drop, Fire, Hurricane, Person, Snowflake, ThermometerHot, Tornado, type Icon } from "@phosphor-icons/react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { motion } from "motion/react";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import usAtlas from "us-atlas/states-albers-10m.json";
import { cameraMove, sceneMove } from "../motion";
import type { Beat } from "../script";
import { Percent } from "../percent";
import { Show } from "../show";
import { DISASTERS, MARK, placeLabels, type DisasterKind, type LabelPlace, type LabelSide } from "./disasters";

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

const ICONS: Record<DisasterKind, Icon> = { fire: Fire, hurricane: Hurricane, flood: Drop, tornado: Tornado, freeze: Snowflake, heat: ThermometerHot };

const projected = DISASTERS.map((disaster) => {
  const [x, y] = albers([disaster.lng, disaster.lat]) ?? [0, 0];
  return { ...disaster, x: MAP_LEFT + x * SCALE, y: MAP_TOP + y * SCALE, text: `${disaster.name} ${disaster.year}` };
});
const places = placeLabels(projected);
const placed = projected.map((disaster, i) => ({ ...disaster, ...places[i] }));
const altadena = placed[0];

// Each mark's center sits on its place; the label hangs off the side placeLabels chose.
const LAYOUT: Record<LabelSide, string> = {
  right: "items-center",
  left: "flex-row-reverse items-center",
  above: "-translate-x-1/2 flex-col-reverse items-center",
  below: "-translate-x-1/2 flex-col items-center",
};

function anchor({ x, y, side }: { x: number; y: number; side: LabelSide }) {
  const half = MARK / 2;
  if (side === "left") return { right: 1920 - x - half, top: y - half };
  if (side === "right") return { left: x - half, top: y - half };
  if (side === "above") return { left: x, bottom: 1080 - y - half };
  return { left: x, top: y - half };
}

// A label slid up or down beside its mark, when the centred spot was taken.
const shiftOf = ({ shift }: LabelPlace) => (shift ? `translateY(${shift}px)` : undefined);

function DisasterMark({ disaster, shown, delay, first }: { disaster: (typeof placed)[number]; shown: boolean; delay: number; first: boolean }) {
  const Glyph = ICONS[disaster.kind];
  return (
    <Show when={shown} delay={delay} rise={10} className="absolute" style={anchor(disaster)}>
      <span className={`flex gap-2 ${LAYOUT[disaster.side]}`}>
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-signal text-on-night ${first ? "shadow-[0_0_0_5px_var(--night),0_0_40px_12px_oklch(0.585_0.215_27/0.55)]" : "shadow-[0_0_0_3px_var(--night)]"}`}
          style={{ width: MARK, height: MARK }}
        >
          <Glyph size={20} weight="fill" aria-hidden />
        </span>
        <span className="type-deck-note whitespace-nowrap rounded-lg bg-night/80 px-2.5" style={{ transform: shiftOf(disaster) }}>
          {disaster.name} <span className="tabular-nums text-on-night-muted">{disaster.year}</span>
        </span>
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
        <p className="type-deck-lede mt-10">of people with disabilities can’t evacuate without difficulty</p>
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
        <DisasterMark key={disaster.name} disaster={disaster} shown={marking} first={i === 0} delay={i === 0 ? 0.6 : 1.2 + i * 0.07} />
      ))}
      <EightyPercent shown={beat === "eighty"} />
    </>
  );
}
