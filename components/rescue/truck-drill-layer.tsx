"use client";

import { Check, FireSimple, FireTruck, House, X } from "@phosphor-icons/react";
import { Anchor, MapLine } from "@/components/map/layers";
import { Point } from "@/lib/ink-map/data";
import { Drill, homeStateAt, HomeState, LocalDrill, truckAt, useDrillSeconds } from "./use-truck-drill";

const PAPER = "var(--map-paper)";
const INK = "var(--map-ink)";
const HAZARD = "var(--signal)";
const EMBER = "var(--ember)";
const SAFE = "var(--leaving)";

const LINE = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

// A home on the truck's list. Waiting is an ink ring with the head count; out is a green check;
// a red cross where the crew got there after the fire; a red flame where the truck never came.
function DrillHomeMark({ at, people, state }: { at: Point; people: number; state: HomeState }) {
  return (
    <Anchor point={at}>
      <title>{TITLES[state]}</title>
      {state === "waiting" && (
        <>
          <circle r={9} fill={PAPER} stroke={INK} strokeWidth={2} />
          <text y={3.8} textAnchor="middle" fontSize={10} fontWeight={800} fill={INK}>
            {people}
          </text>
        </>
      )}
      {state === "rescued" && (
        <>
          <circle r={9} fill={SAFE} stroke={PAPER} strokeWidth={2} />
          <Check x={-5.5} y={-5.5} size={11} weight="bold" color="white" />
        </>
      )}
      {state === "too_late" && (
        <>
          <circle r={9} fill={HAZARD} stroke={PAPER} strokeWidth={2} />
          <X x={-5.5} y={-5.5} size={11} weight="bold" color="white" />
        </>
      )}
      {state === "never_reached" && (
        <>
          <circle r={9} fill={HAZARD} stroke={PAPER} strokeWidth={2} />
          <FireSimple x={-5.5} y={-5.5} size={11} weight="fill" color="white" />
        </>
      )}
    </Anchor>
  );
}

const TITLES: Record<HomeState, string> = {
  waiting: "Waiting for the truck",
  rescued: "Picked up before the fire",
  too_late: "The truck got there after the fire",
  never_reached: "The fire got there before the truck ever came",
};

function TruckMark({ at, onboard, moving }: { at: Point; onboard: number; moving: boolean }) {
  return (
    <Anchor point={at}>
      <title>{`Fire engine, ${onboard} on board`}</title>
      {moving && <circle r={20} fill={EMBER} opacity={0.25} />}
      <circle r={15} fill={PAPER} />
      <circle r={13} fill={INK} />
      <FireTruck x={-8} y={-8} size={16} weight="fill" color="white" />
      {onboard > 0 && (
        <g transform="translate(12 -11)">
          <circle r={8} fill={SAFE} stroke={PAPER} strokeWidth={2} />
          <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={800} fill="white">
            {onboard}
          </text>
        </g>
      )}
    </Anchor>
  );
}

// The fire engine's run, replayed: the streets already driven faint, the leg it is on solid, every
// home on its list changing as the truck or the fire gets there first.
export function TruckDrillLayer({ drill, local }: { drill: Drill; local: LocalDrill }) {
  const seconds = useDrillSeconds(drill, 100);
  const truck = truckAt(drill, local, seconds);
  const driven = local.legs.slice(0, Math.max(truck.legIndex, 0));
  const current = local.legs[truck.legIndex];
  return (
    <g>
      {driven.map((leg, i) => (
        <MapLine key={i} route={leg.path} {...LINE} stroke={INK} strokeOpacity={0.18} strokeWidth={2} />
      ))}
      {current && (
        <>
          <MapLine route={current.path} {...LINE} stroke={PAPER} strokeWidth={6} />
          <MapLine route={current.path} {...LINE} stroke={INK} strokeWidth={3} />
        </>
      )}
      <Anchor point={local.shelter}>
        <title>{drill.shelter.name}</title>
        <circle r={11} fill={PAPER} stroke={INK} strokeWidth={2} />
        <House x={-6.5} y={-6.5} size={13} weight="fill" color={INK} />
      </Anchor>
      {local.homes.map((home, i) => (
        <DrillHomeMark key={i} at={home.at} people={home.people} state={homeStateAt(home, seconds)} />
      ))}
      <TruckMark at={truck.at} onboard={truck.onboard} moving={truck.moving} />
    </g>
  );
}
