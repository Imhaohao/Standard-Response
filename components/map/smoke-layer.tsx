"use client";

import { CSSProperties, ReactNode, useMemo } from "react";
import { Point } from "@/lib/ink-map/data";
import { ScenarioFront } from "@/lib/ink-map/fire-field";
import { useMapStage } from "./map-stage";

// Smoke drawn the manga way: round puffs with an ink outline and a halftone shadow, rising off the
// whole burning edge and leaning downwind, thickest where the front is spreading fastest. Each puff's path is a
// real line in the air, from the burning ground to a point downwind and high above it, projected
// through the camera, so the plume keeps its heading at any zoom. CSS animates the puff along it,
// so React only re-renders when the view or the fire's minute changes.

const PUFFS = 72;
const LIFE_SECONDS = 9;
const EDGE_SAMPLES = 96;
// The scenario's wind carries smoke toward the west-southwest.
const DOWNWIND: Point = [-0.92, -0.38];
const DRIFT_METERS = 1000;
const RISE_METERS = 650;
const PUFF_METERS = 60;
const MAX_PUFF_PIXELS = 280;

type Source = { point: Point; strength: number };

function sampleRing(ring: Point[], count: number): Point[] {
  const step = Math.max(1, Math.floor(ring.length / count));
  return ring.filter((_, index) => index % step === 0);
}

function distanceToRing(ring: Point[], [x, y]: Point) {
  let best = Infinity;
  for (const [rx, ry] of ring) best = Math.min(best, Math.hypot(rx - x, ry - y));
  return best;
}

// The burning edge right now, and how far the fire will push past each part of it by the next
// front. A long push means a hot, fast run, which is where the smoke is thickest.
function smokeSources(fronts: ScenarioFront[], minutes: number): Source[] {
  const index = fronts.findLastIndex((front) => front.minutes <= minutes);
  if (index < 0) return [];
  const next = fronts[index + 1];
  const nextRing = next ? sampleRing(next.ring, EDGE_SAMPLES * 2) : null;
  const edge = sampleRing(fronts[index].ring, EDGE_SAMPLES).map((point) => ({ point, strength: nextRing ? distanceToRing(nextRing, point) : 1 }));
  const strongest = Math.max(...edge.map((source) => source.strength)) || 1;
  return edge.map((source) => ({ ...source, strength: Math.max(0.2, source.strength / strongest) }));
}

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// Each puff rises from its own spot on the edge, picked more often where the front runs hotter.
function sourceFor(sources: Source[], total: number, puffIndex: number) {
  let left = hash(puffIndex + 1) * total;
  for (const source of sources) {
    left -= source.strength;
    if (left <= 0) return source;
  }
  return sources[sources.length - 1];
}

type Puff = { key: string; x: number; y: number; r: number; dx: number; dy: number; delay: number };

export function SmokeLayer({ fronts, minutes }: { fronts: ScenarioFront[]; minutes: number }) {
  const { project, version, size } = useMapStage();
  const sources = useMemo(() => smokeSources(fronts, minutes), [fronts, minutes]);

  const puffs = useMemo(() => {
    if (sources.length === 0) return [];
    const total = sources.reduce((sum, source) => sum + source.strength, 0);
    const list: Puff[] = [];
    for (let i = 0; i < PUFFS; i++) {
      const puff = puffFrom(project, sourceFor(sources, total, i), i);
      if (puff) list.push(puff);
    }
    return list;
    // `version` changes whenever the camera moves; `project` is stable across those moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, project, version]);

  if (puffs.length === 0) return null;
  // Three passes over the same animated puffs: a fat ink outline, the paper fill on top of it (which
  // hides every outline inside the cloud, leaving one scalloped silhouette), then a halftone shadow
  // seen through a mask, so overlapping puffs share one even dot screen instead of stacking.
  return (
    <g aria-hidden>
      <defs>
        <pattern id="smoke-tone" width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <circle cx={2} cy={2} r={0.95} fill="var(--map-ink)" />
        </pattern>
      </defs>
      <PuffPass puffs={puffs} draw={(r) => <circle r={r} fill="var(--map-ink)" stroke="var(--map-ink)" strokeWidth={3} />} />
      <PuffPass puffs={puffs} draw={(r) => <circle r={r} fill="var(--smoke)" />} />
      <mask id="smoke-shadow" maskUnits="userSpaceOnUse" x={0} y={0} width={size.width} height={size.height}>
        <PuffPass puffs={puffs} draw={(r) => <circle r={r} fill="white" />} />
        <PuffPass puffs={puffs} draw={(r) => <circle cx={-r * 0.3} cy={-r * 0.34} r={r * 0.5} fill="black" />} />
      </mask>
      <rect width={size.width} height={size.height} fill="url(#smoke-tone)" mask="url(#smoke-shadow)" opacity={0.5} />
    </g>
  );
}

type Project = (point: Point, lift?: number) => { x: number; y: number; visible: boolean };

const offset = ([x, y]: Point, east: number, north: number): Point => [x + east, y + north];

function puffFrom(project: Project, source: Source, puffIndex: number): Puff | null {
  const jitter = hash(puffIndex * 7.3) * 2 - 1;
  const ground = offset(source.point, jitter * 40, hash(puffIndex * 3.1) * 80 - 40);
  const base = project(ground);
  if (!base.visible) return null;
  const drift = DRIFT_METERS * (1 + jitter * 0.12);
  const top = project(offset(ground, DOWNWIND[0] * drift, DOWNWIND[1] * drift), RISE_METERS * (0.8 + 0.4 * source.strength));
  const edge = project(offset(ground, PUFF_METERS, 0));
  const pixelsPerPuff = Math.hypot(edge.x - base.x, edge.y - base.y);
  return {
    key: String(puffIndex),
    x: base.x,
    y: base.y,
    r: Math.min(MAX_PUFF_PIXELS, pixelsPerPuff * (1 + 0.6 * source.strength) * (1 + jitter * 0.25)),
    dx: top.x - base.x,
    dy: top.y - base.y,
    delay: -hash(puffIndex * 5.7) * LIFE_SECONDS,
  };
}

function PuffPass({ puffs, draw }: { puffs: Puff[]; draw: (r: number) => ReactNode }) {
  return (
    <g>
      {puffs.map((puff) => (
        <g key={puff.key} transform={`translate(${puff.x.toFixed(1)} ${puff.y.toFixed(1)})`}>
          <g
            className="animate-smoke-puff"
            style={{ "--dx": `${puff.dx.toFixed(1)}px`, "--dy": `${puff.dy.toFixed(1)}px`, animationDelay: `${puff.delay.toFixed(2)}s`, animationDuration: `${LIFE_SECONDS}s` } as CSSProperties}
          >
            {draw(puff.r)}
          </g>
        </g>
      ))}
    </g>
  );
}
