import { useId, useMemo } from "react";
import type { Point } from "../../data";
import type { FireField } from "../../fire-field";
import type { PaperHazardProps } from "../types";
import { surfaceAt, waterModel, type WaterKind, type WaterModel } from "./model";
import { depthCells, depthOutlines, drawnBackMeters, standingCells, standingOutline } from "./paper-grid";
import { shoreFor } from "./shore";

// The flat map's water, printed like the 3D one: standing water in a pale indigo with the sea's scale
// pattern, the flood in nested plates that darken with depth, each kind's wave linework cut into it, a
// thin line where every front has passed, and the live edge in ink with a bead of foam along it. A
// tsunami's bore is a white line crossing the bay; the seabed it bares is stippled wet sand.

const INDIGO = "var(--map-indigo)";
const PAPER = "var(--map-paper)";
const INK = "var(--map-ink)";
const DEPTH_BANDS = [0.05, 0.6, 1.5, 3];
const BAND_OPACITY = [0.22, 0.14, 0.14, 0.16];
// Tenths of a minute for a tsunami, whose bore crosses the bay in a few minutes; quarter minutes otherwise.
const STEPS_PER_MINUTE: Record<WaterKind, number> = { flood: 4, surge: 4, tsunami: 10 };
const BORE_SHOWN = { before: 6, after: 8 };
const BORE_HALF_LENGTH = 4000;

type Project = PaperHazardProps["project"];

const ringPath = (project: Project, ring: Point[]) =>
  `${ring
    .map((point, i) => {
      const { x, y } = project(point);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join("")}Z`;

const passedFrontCount = (field: FireField, minutes: number) => field.fronts.filter((front) => front.minutes <= minutes).length;

// The angle on the flat map, in degrees, of a direction on the ground.
function screenAngle(project: Project, [dx, dy]: Point, at: Point) {
  const a = project(at);
  const b = project([at[0] + dx * 100, at[1] + dy * 100]);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// Where each crest of a tsunami stands at this minute, as a line square to its travel, while it is
// crossing the bay or running inland.
function boreLines(model: WaterModel, minutes: number, project: Project) {
  const train = model.train;
  if (!train) return [];
  const across: Point = [-train.travel[1], train.travel[0]];
  return train.waves.flatMap((wave) => {
    const since = minutes - wave.arrival;
    if (since < -BORE_SHOWN.before || since > BORE_SHOWN.after) return [];
    const travelled = since < 0 ? since * train.celerity.sea : since * train.celerity.land;
    const centre: Point = [train.reference[0] + train.travel[0] * travelled, train.reference[1] + train.travel[1] * travelled];
    const a = project([centre[0] - across[0] * BORE_HALF_LENGTH, centre[1] - across[1] * BORE_HALF_LENGTH]);
    const b = project([centre[0] + across[0] * BORE_HALF_LENGTH, centre[1] + across[1] * BORE_HALF_LENGTH]);
    return [{ d: `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`, weight: Math.min(1, wave.runup / 4) }];
  });
}

function usePatternIds() {
  const id = useId().replace(/:/g, "");
  return { ripple: `${id}-ripple`, swell: `${id}-swell`, scales: `${id}-scales`, churn: `${id}-churn`, sand: `${id}-sand`, clip: `${id}-clip` };
}

type Ids = ReturnType<typeof usePatternIds>;

function Patterns({ ids, swellAngle }: { ids: Ids; swellAngle: number }) {
  return (
    <defs>
      <pattern id={ids.ripple} width={22} height={14} patternUnits="userSpaceOnUse">
        <path d="M2 9q3.5-3.5 7 0M13 3q3.5-3.5 7 0" fill="none" stroke={INDIGO} strokeWidth={0.8} strokeLinecap="round" />
      </pattern>
      <pattern id={ids.swell} width={28} height={11} patternUnits="userSpaceOnUse" patternTransform={`rotate(${swellAngle + 90})`}>
        <path d="M0 6q7-5 14 0t14 0" fill="none" stroke={INDIGO} strokeWidth={0.9} />
        <path d="M11 3.4q2-1.6 3.6 0.3" fill="none" stroke={PAPER} strokeWidth={1.4} strokeLinecap="round" />
      </pattern>
      <pattern id={ids.scales} width={24} height={12} patternUnits="userSpaceOnUse">
        {[
          [0, 0],
          [24, 0],
          [12, 6],
          [0, 12],
          [24, 12],
        ].map(([cx, cy]) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r={12} fill={INDIGO} fillOpacity={0.24} />
            {[11.5, 8.5, 5.5, 2.5].map((r) => (
              <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke={PAPER} strokeOpacity={0.75} strokeWidth={0.7} />
            ))}
          </g>
        ))}
      </pattern>
      <pattern id={ids.churn} width={30} height={7} patternUnits="userSpaceOnUse" patternTransform={`rotate(${swellAngle})`}>
        <path d="M1 2h13M17 5.5h10" stroke={INDIGO} strokeWidth={0.8} strokeLinecap="round" />
      </pattern>
      <pattern id={ids.sand} width={5} height={5} patternUnits="userSpaceOnUse">
        <circle cx={1.2} cy={1.4} r={0.55} fill={INK} fillOpacity={0.45} />
        <circle cx={3.8} cy={3.7} r={0.45} fill={INK} fillOpacity={0.35} />
      </pattern>
    </defs>
  );
}

const LINEWORK: Record<WaterKind, keyof Ids> = { flood: "ripple", surge: "swell", tsunami: "churn" };

function useWaterDrawing({ kind, data, field, scenario, minutes, project, trace }: PaperHazardProps & { kind: WaterKind }) {
  const steps = STEPS_PER_MINUTE[kind];
  const shown = Math.round(minutes * steps) / steps;
  const model = useMemo(() => waterModel(scenario, data, field, kind), [scenario, data, field, kind]);
  const shore = useMemo(() => shoreFor(data, kind), [data, kind]);
  const cells = useMemo(() => depthCells(data, field, shore), [data, field, shore]);
  const standing = useMemo(() => standingCells(shore), [shore]);
  const toPath = useMemo(() => (rings: Point[][]) => rings.map((ring) => ringPath(project, ring)).join(""), [project]);
  const sea = useMemo(() => toPath(standingOutline(standing, 0)), [standing, toPath]);
  const drawnBack = model.train ? Math.round(drawnBackMeters(surfaceAt(model, model.train.reference, shown)) / 20) * 20 : 0;
  const stillSea = useMemo(() => (drawnBack > 0 ? toPath(standingOutline(standing, drawnBack)) : sea), [drawnBack, sea, standing, toPath]);
  const bands = useMemo(() => depthOutlines(cells, model, shown, DEPTH_BANDS).map(toPath), [cells, model, shown, toPath]);
  const reached = useMemo(() => trace(shown), [trace, shown]);
  const passed = passedFrontCount(field, shown);
  const fronts = useMemo(() => field.fronts.slice(0, passed).map((front) => ({ minutes: front.minutes, d: trace(front.minutes) })), [field, passed, trace]);
  const centre: Point = [(field.region.x0 + field.region.x1) / 2, (field.region.y0 + field.region.y1) / 2];
  return {
    kind,
    sea,
    stillSea,
    bared: drawnBack > 0,
    bands,
    water: bands[0],
    reachedDry: model.train ? reached : "",
    fronts,
    swellAngle: screenAngle(project, model.train?.travel ?? shore.onshore, centre),
    bores: boreLines(model, shown, project),
  };
}

type Drawing = ReturnType<typeof useWaterDrawing>;

function StandingWater({ drawing, ids }: { drawing: Drawing; ids: Ids }) {
  const { sea, stillSea, bared, kind } = drawing;
  return (
    <>
      {bared && <path d={sea} fill={`url(#${ids.sand})`} fillRule="evenodd" />}
      <path d={stillSea} fill={INDIGO} fillOpacity={0.16} fillRule="evenodd" />
      {kind !== "flood" && <path d={stillSea} fill={`url(#${ids.scales})`} fillRule="evenodd" />}
    </>
  );
}

function RisenWater({ drawing, ids }: { drawing: Drawing; ids: Ids }) {
  const { bands, water, reachedDry, fronts, kind } = drawing;
  return (
    <>
      <path d={reachedDry} fill={INK} fillOpacity={0.07} fillRule="evenodd" />
      {bands.map((band, i) => (
        <path key={DEPTH_BANDS[i]} d={band} fill={INDIGO} fillOpacity={BAND_OPACITY[i]} fillRule="evenodd" />
      ))}
      <path d={water} fill={`url(#${ids[LINEWORK[kind]]})`} fillRule="evenodd" />
      {fronts.map((front) => (
        <path key={front.minutes} d={front.d} fill="none" stroke={INDIGO} strokeOpacity={0.45} strokeWidth={0.8} strokeLinejoin="round" />
      ))}
      <path d={water} fill="none" stroke={PAPER} strokeWidth={4} strokeDasharray="0.5 5" strokeLinecap="round" />
      <path d={water} fill="none" stroke={INDIGO} strokeWidth={1.6} strokeLinejoin="round" />
    </>
  );
}

function Bores({ drawing, ids }: { drawing: Drawing; ids: Ids }) {
  if (drawing.bores.length === 0) return null;
  return (
    <>
      <clipPath id={ids.clip}>
        <path d={`${drawing.stillSea}${drawing.water}`} />
      </clipPath>
      <g clipPath={`url(#${ids.clip})`}>
        {drawing.bores.map((bore) => (
          <g key={bore.d}>
            <path d={bore.d} stroke={INDIGO} strokeWidth={4 + 6 * bore.weight} strokeOpacity={0.55} />
            <path d={bore.d} stroke={PAPER} strokeWidth={2 + 4 * bore.weight} strokeDasharray="7 2 2 2" />
          </g>
        ))}
      </g>
    </>
  );
}

export function WaterPaper(props: PaperHazardProps & { kind: WaterKind }) {
  const ids = usePatternIds();
  const drawing = useWaterDrawing(props);
  return (
    <g>
      <Patterns ids={ids} swellAngle={drawing.swellAngle} />
      <StandingWater drawing={drawing} ids={ids} />
      <RisenWater drawing={drawing} ids={ids} />
      <Bores drawing={drawing} ids={ids} />
    </g>
  );
}
