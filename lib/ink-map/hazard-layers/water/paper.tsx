import { useId, useMemo } from "react";
import type { Point } from "../../data";
import type { PaperHazardProps } from "../types";
import { surfaceAt, waterModel, type WaterKind, type WaterModel } from "./model";
import { depthCells, depthOutlines, drawnBackMeters, standingCells, standingOutline } from "./paper-grid";
import { shoreFor } from "./shore";
import { waterField } from "./source";

// The flat map's water, printed like the 3D one: standing water in a pale indigo, the flood in nested
// plates that darken with depth, each kind's tapered strokes scattered through it, and the live edge in
// ink with uneven runs of foam inside it. A tsunami's bore is a broken white line crossing the bay; the
// seabed it bares is stippled wet sand.

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
  return { ripple: `${id}-ripple`, swell: `${id}-swell`, scales: `${id}-scales`, churn: `${id}-churn`, sand: `${id}-sand`, clip: `${id}-clip`, edge: `${id}-edge` };
}

type Ids = ReturnType<typeof usePatternIds>;

// A deterministic scatter, so a pattern tile holds marks of many sizes in no visible order.
function scatter(seed: number, count: number) {
  let state = seed * 9301 + 49297;
  const next = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  return Array.from({ length: count }, () => ({ x: next(), y: next(), size: next(), bend: next() - 0.5 }));
}

const TILE = { width: 180, height: 120 };

// Tapered strokes, each a thin lens of its own length, weight and curve, laid along the tile's x axis.
const strokeMarks = (seed: number, count: number, longest: number) =>
  scatter(seed, count)
    .map(({ x, y, size, bend }) => {
      const length = longest * (0.35 + 0.65 * size);
      const weight = 0.5 + 1.3 * size * size;
      const [x0, y0] = [x * TILE.width, y * TILE.height];
      const sag = bend * length * 0.25;
      return `M${x0.toFixed(1)} ${y0.toFixed(1)}q${(length / 2).toFixed(1)} ${(sag - weight).toFixed(1)} ${length.toFixed(1)} 0q${(-length / 2).toFixed(1)} ${(-sag + weight).toFixed(1)} ${(-length).toFixed(1)} 0Z`;
    })
    .join("");

const sandMarks = scatter(7, 70).map(({ x, y, size }) => ({ cx: x * 60, cy: y * 60, r: 0.3 + 0.7 * size * size }));

function Patterns({ ids, swellAngle }: { ids: Ids; swellAngle: number }) {
  return (
    <defs>
      <pattern id={ids.ripple} width={TILE.width} height={TILE.height} patternUnits="userSpaceOnUse">
        <path d={strokeMarks(3, 9, 26)} fill={INDIGO} fillOpacity={0.7} />
      </pattern>
      <pattern id={ids.swell} width={TILE.width} height={TILE.height} patternUnits="userSpaceOnUse" patternTransform={`rotate(${swellAngle + 90})`}>
        <path d={strokeMarks(5, 22, 46)} fill={INDIGO} fillOpacity={0.75} />
        <path d={strokeMarks(11, 7, 14)} fill={PAPER} />
      </pattern>
      <pattern id={ids.scales} width={TILE.width} height={TILE.height} patternUnits="userSpaceOnUse" patternTransform={`rotate(${swellAngle + 90})`}>
        <path d={strokeMarks(17, 6, 30)} fill={INDIGO} fillOpacity={0.5} />
      </pattern>
      <pattern id={ids.churn} width={TILE.width} height={TILE.height} patternUnits="userSpaceOnUse" patternTransform={`rotate(${swellAngle})`}>
        <path d={strokeMarks(13, 26, 40)} fill={INDIGO} fillOpacity={0.75} />
      </pattern>
      <pattern id={ids.sand} width={60} height={60} patternUnits="userSpaceOnUse">
        {sandMarks.map((mark) => (
          <circle key={`${mark.cx.toFixed(2)}-${mark.cy.toFixed(2)}`} cx={mark.cx} cy={mark.cy} r={mark.r} fill={INK} fillOpacity={0.4} />
        ))}
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
  const cells = useMemo(() => depthCells(data, waterField(field, model, shore), shore), [data, field, model, shore]);
  const standing = useMemo(() => standingCells(shore), [shore]);
  const toPath = useMemo(() => (rings: Point[][]) => rings.map((ring) => ringPath(project, ring)).join(""), [project]);
  const sea = useMemo(() => toPath(standingOutline(standing, 0)), [standing, toPath]);
  const drawnBack = model.train ? Math.round(drawnBackMeters(surfaceAt(model, model.train.reference, shown)) / 20) * 20 : 0;
  const stillSea = useMemo(() => (drawnBack > 0 ? toPath(standingOutline(standing, drawnBack)) : sea), [drawnBack, sea, standing, toPath]);
  const bands = useMemo(() => depthOutlines(cells, model, shown, DEPTH_BANDS).map(toPath), [cells, model, shown, toPath]);
  const reached = useMemo(() => trace(shown), [trace, shown]);
  const centre: Point = [(field.region.x0 + field.region.x1) / 2, (field.region.y0 + field.region.y1) / 2];
  return {
    kind,
    sea,
    stillSea,
    bared: drawnBack > 0,
    bands,
    water: bands[0],
    reachedDry: model.train ? reached : "",
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

// Foam along the inside of the water's edge, broken into runs of uneven length.
const FOAM_RUNS = "16 3 5 2 27 4 9 2 13 5 4 2 21 3";

function RisenWater({ drawing, ids }: { drawing: Drawing; ids: Ids }) {
  const { bands, water, reachedDry, kind } = drawing;
  return (
    <>
      <path d={reachedDry} fill={INK} fillOpacity={0.07} fillRule="evenodd" />
      {bands.map((band, i) => (
        <path key={DEPTH_BANDS[i]} d={band} fill={INDIGO} fillOpacity={BAND_OPACITY[i]} fillRule="evenodd" />
      ))}
      <path d={water} fill={`url(#${ids[LINEWORK[kind]]})`} fillRule="evenodd" />
      <clipPath id={ids.edge}>
        <path d={water} clipRule="evenodd" />
      </clipPath>
      <path d={water} fill="none" stroke={PAPER} strokeWidth={5} strokeDasharray={FOAM_RUNS} clipPath={`url(#${ids.edge})`} />
      <path d={water} fill="none" stroke={INDIGO} strokeWidth={1.4} strokeLinejoin="round" />
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
            <path d={bore.d} stroke={PAPER} strokeWidth={2 + 4 * bore.weight} strokeDasharray="19 3 6 2 31 4 11 2 15 5" />
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
