"use client";

import { CSSProperties, ReactNode, useMemo } from "react";
import { Point } from "@/lib/ink-map/data";
import { ScenarioFront } from "@/lib/ink-map/fire-field";
import { useMapStage } from "./map-stage";

// Smoke drawn the manga way: round puffs with an ink outline and a halftone shadow, rising off the
// stretches of fire front that are spreading fastest and leaning downwind. Each puff is animated by
// CSS in screen space, so React only re-renders when the view or the fire's minute changes.

const SOURCES = 5;
const PUFFS_PER_SOURCE = 14;
const LIFE_SECONDS = 9;
const SOURCE_SPACING_METERS = 300;
// The scenario's wind carries smoke toward the west-southwest.
const DOWNWIND: Point = [-0.92, -0.38];
const DRIFT_METERS = 1000;
const SAMPLES = 64;

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
  const now = fronts[index];
  const next = fronts[index + 1];
  const nextRing = next ? sampleRing(next.ring, SAMPLES * 2) : null;
  const candidates = sampleRing(now.ring, SAMPLES)
    .map((point) => ({ point, strength: nextRing ? distanceToRing(nextRing, point) : 1 }))
    .sort((a, b) => b.strength - a.strength);
  const picked: Source[] = [];
  for (const candidate of candidates) {
    if (picked.length === SOURCES) break;
    const crowded = picked.some((source) => Math.hypot(source.point[0] - candidate.point[0], source.point[1] - candidate.point[1]) < SOURCE_SPACING_METERS);
    if (!crowded) picked.push(candidate);
  }
  const strongest = picked[0]?.strength || 1;
  return picked.map((source) => ({ ...source, strength: Math.max(0.45, source.strength / strongest) }));
}

type Puff = { key: string; x: number; y: number; r: number; dx: number; dy: number; delay: number };

export function SmokeLayer({ fronts, minutes }: { fronts: ScenarioFront[]; minutes: number }) {
  const { project, version, size } = useMapStage();
  const sources = useMemo(() => smokeSources(fronts, minutes), [fronts, minutes]);

  const puffs = useMemo(() => {
    const list: Puff[] = [];
    sources.forEach((source, s) => {
      const base = project(source.point);
      if (!base.visible) return;
      const downwind = project([source.point[0] + DOWNWIND[0] * DRIFT_METERS, source.point[1] + DOWNWIND[1] * DRIFT_METERS]);
      // How many pixels a few hundred metres take at this zoom, so the plume scales with the map.
      const scale = Math.min(Math.hypot(downwind.x - base.x, downwind.y - base.y), 900);
      for (let i = 0; i < PUFFS_PER_SOURCE; i++) {
        const jitter = Math.sin(s * 12.9 + i * 78.2);
        list.push({
          key: `${s}-${i}`,
          x: base.x + jitter * scale * 0.05,
          y: base.y,
          r: scale * (0.06 + 0.035 * source.strength) * (1 + jitter * 0.25),
          dx: downwind.x - base.x + jitter * scale * 0.12,
          dy: downwind.y - base.y - scale * (0.9 + 0.5 * source.strength),
          delay: -((i / PUFFS_PER_SOURCE) * LIFE_SECONDS + s * 0.7),
        });
      }
    });
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
