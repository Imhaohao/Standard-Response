import { useId, useMemo } from "react";
import { ROAD_WIDTH, type InkMapData, type Point } from "../../data";
import type { Scenario } from "../../scenario";
import type { PaperHazardProps } from "../types";
import { closedUnder, closureBarriers, closureRules, closureStateKey, isClosed, isStreet, roadRules, roadWindows, type Barrier } from "./roads";
import { blizzardWeather } from "./weather";

// The blizzard on the flat map: snow stippled over the whole town and a paper veil that buries the
// streets as it deepens and thickens in the whiteout, the paper dimming after dark, closed streets
// hatched through with a barrier at each mouth, open and ploughed streets as firm ink, and flakes
// drifting across the map with the wind.

type Project = PaperHazardProps["project"];

const fmt = (n: number) => n.toFixed(1);

function pathOf(project: Project, path: Point[]) {
  const points = path.map((point) => project(point));
  if (!points.some((point) => point.visible)) return "";
  return points.map((point, i) => `${i === 0 ? "M" : "L"}${fmt(point.x)} ${fmt(point.y)}`).join("");
}

// Pixels per metre on the flat map, measured off the projection itself.
function pixelsPerMeter(project: Project) {
  const a = project([0, 0]);
  const b = project([100, 0]);
  return Math.hypot(b.x - a.x, b.y - a.y) / 100;
}

type StreetPath = { key: string; d: string; width: number };
type StreetPaths = { closed: StreetPath[]; open: StreetPath[] };

// Streets grouped by class and by whether the storm has them shut, one path each.
function streetPaths(data: InkMapData, rulesByRoad: number[][], stateKey: string, project: Project): StreetPaths {
  const scale = pixelsPerMeter(project);
  const groups = new Map<string, { closed: boolean; roadClass: number; parts: string[] }>();
  data.roads.forEach((road, index) => {
    if (!isStreet(road)) return;
    const d = pathOf(project, road.path);
    if (!d) return;
    const closed = closedUnder(rulesByRoad[index], stateKey);
    const key = `${closed}-${road.roadClass}`;
    const group = groups.get(key) ?? { closed, roadClass: road.roadClass, parts: [] };
    group.parts.push(d);
    groups.set(key, group);
  });
  const paths: StreetPaths = { closed: [], open: [] };
  for (const [key, group] of groups) {
    const width = Math.max(1, ROAD_WIDTH[group.roadClass] * scale);
    (group.closed ? paths.closed : paths.open).push({ key, d: group.parts.join(""), width });
  }
  return paths;
}

function useClosures(data: InkMapData, scenario: Scenario | null) {
  return useMemo(() => {
    const rules = closureRules(scenario, data);
    const windows = roadWindows(data, rules);
    return { rules, rulesByRoad: roadRules(data, rules), barriers: closureBarriers(data, windows) };
  }, [data, scenario]);
}

// Deterministic speck positions in a 24 px tile.
const SPECKS = Array.from({ length: 14 }, (_, i) => {
  const hash = (n: number) => {
    const x = Math.sin(n * 91.7 + 13.1) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: hash(i) * 24, y: hash(i + 0.37) * 24, r: 0.5 + hash(i + 0.71) * 0.5 };
});

const FLAKES = SPECKS.slice(0, 5).map((speck, i) => ({ x: (speck.x * 2.3) % 48, y: (speck.y * 1.9 + i * 9) % 48, r: 1.3 + speck.r * 1.2 }));

function BarrierMark({ barrier, project, hatch }: { barrier: Barrier; project: Project; hatch: string }) {
  const at = project(barrier.at);
  if (!at.visible) return null;
  const ahead = project([barrier.at[0] + Math.cos(barrier.angle), barrier.at[1] + Math.sin(barrier.angle)]);
  const degrees = (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI + 90;
  return (
    <g transform={`translate(${fmt(at.x)} ${fmt(at.y)}) rotate(${fmt(degrees)})`}>
      <rect x={-5} y={-2} width={10} height={4} fill="var(--map-paper)" />
      <rect x={-5} y={-2} width={10} height={4} fill={`url(#${hatch})`} stroke="var(--map-ink)" strokeWidth={1} />
    </g>
  );
}

// The flakes' tile slides a whole number of tiles each loop, so the drift never jumps.
function driftTo(windToward: [number, number], tiles: number) {
  const [east, north] = windToward;
  return `${Math.round(east * tiles) * 48} ${Math.round(-north * tiles) * 48}`;
}

export function BlizzardPaper({ data, scenario, minutes, project }: PaperHazardProps) {
  const id = useId().replace(/:/g, "");
  const weather = blizzardWeather(scenario, minutes, data.origin);
  const { rules, rulesByRoad, barriers } = useClosures(data, scenario);
  const stateKey = closureStateKey(rules, minutes);
  const streets = useMemo(() => streetPaths(data, rulesByRoad, stateKey, project), [data, rulesByRoad, stateKey, project]);
  const presence = Math.min(1, weather.depthMeters / 0.05);
  const veil = Math.min(0.85, presence * 0.5 + weather.whiteout * 0.3);
  const night = 1 - weather.daylight;
  const ids = { hatch: `${id}-hatch`, specks: `${id}-specks`, flakes: `${id}-flakes` };
  return (
    <g>
      <defs>
        <pattern id={ids.hatch} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={4} stroke="var(--map-ink)" strokeWidth={1.3} />
        </pattern>
        <pattern id={ids.specks} width={24} height={24} patternUnits="userSpaceOnUse">
          {SPECKS.map((speck, i) => (
            <circle key={i} cx={speck.x} cy={speck.y} r={speck.r} fill="var(--map-ink)" />
          ))}
        </pattern>
        <pattern id={ids.flakes} width={48} height={48} patternUnits="userSpaceOnUse">
          {FLAKES.map((flake, i) => (
            <circle key={i} cx={flake.x} cy={flake.y} r={flake.r} fill="var(--map-paper)" stroke="var(--map-ink)" strokeWidth={0.8} />
          ))}
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to={driftTo(weather.windToward, 3)} dur="6s" repeatCount="indefinite" />
        </pattern>
      </defs>
      <rect x={-10000} y={-10000} width={30000} height={30000} fill="var(--map-paper)" opacity={veil} />
      <rect x={-10000} y={-10000} width={30000} height={30000} fill={`url(#${ids.specks})`} opacity={0.32 * presence} />
      {presence > 0.2 &&
        streets.open.map((street) => <path key={street.key} d={street.d} fill="none" stroke="var(--map-ink)" strokeOpacity={0.7} strokeWidth={Math.max(1, street.width * 0.5)} strokeLinecap="round" />)}
      {streets.closed.map((street) => (
        <path key={street.key} d={street.d} fill="none" stroke={`url(#${ids.hatch})`} strokeOpacity={0.5} strokeWidth={Math.max(3, street.width)} strokeLinecap="butt" />
      ))}
      {barriers
        .filter((barrier) => isClosed(barrier.window, minutes))
        .map((barrier, i) => (
          <BarrierMark key={i} barrier={barrier} project={project} hatch={ids.hatch} />
        ))}
      <rect x={-10000} y={-10000} width={30000} height={30000} fill="var(--map-ink)" opacity={night * 0.3} />
      <rect x={-10000} y={-10000} width={30000} height={30000} fill={`url(#${ids.flakes})`} opacity={weather.snowfall} />
    </g>
  );
}
