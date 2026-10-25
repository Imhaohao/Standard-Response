import { useId, useMemo } from "react";
import { ROAD_WIDTH, type InkMapData, type Point } from "../../data";
import type { Scenario } from "../../scenario";
import type { PaperHazardProps } from "../types";
import { closureRules, isClosed, MOST_STREET_CLASS, roadWindows, type ClosureWindow } from "./roads";
import { blizzardWeather } from "./weather";

// The blizzard on the flat map, drawn the way the 3D map draws it: by taking ink away. As the snow
// deepens the area tints and minor paths fade into the paper; every street is overdrawn, open ones as
// a dark double line of ruts and closed ones erased into the white over the hour and a half after they
// shut. A light veil comes and goes with visibility, and a few ink-ringed flakes drift with the wind.

type Project = PaperHazardProps["project"];

const ERASE_MINUTES = 90;
const MOST_VEIL = 0.22;

const fmt = (n: number) => n.toFixed(1);

function pathOf(project: Project, path: Point[], closed = false) {
  const points = path.map((point) => project(point));
  if (!points.some((point) => point.visible)) return "";
  return points.map((point, i) => `${i === 0 ? "M" : "L"}${fmt(point.x)} ${fmt(point.y)}`).join("") + (closed ? "Z" : "");
}

// Pixels per metre on the flat map, measured off the projection itself.
function pixelsPerMeter(project: Project) {
  const a = project([0, 0]);
  const b = project([100, 0]);
  return Math.hypot(b.x - a.x, b.y - a.y) / 100;
}

type StreetGroup = { key: string; d: string; width: number; window: ClosureWindow };

// Streets in one path per class and closure window, so each group fades on its own clock.
function streetGroups(data: InkMapData, windows: ClosureWindow[], project: Project): StreetGroup[] {
  const scale = pixelsPerMeter(project);
  const groups = new Map<string, StreetGroup>();
  data.roads.forEach((road, index) => {
    if (road.tunnel || road.roadClass > MOST_STREET_CLASS || road.path.length < 2) return;
    const d = pathOf(project, road.path);
    if (!d) return;
    const window = windows[index];
    const key = `${road.roadClass}:${window.closedAt}:${window.reopensAt}`;
    const group = groups.get(key) ?? { key, d: "", width: Math.max(1, ROAD_WIDTH[road.roadClass] * scale), window };
    group.d += d;
    groups.set(key, group);
  });
  return [...groups.values()];
}

function minorPaths(data: InkMapData, project: Project) {
  return data.roads
    .filter((road) => road.roadClass > MOST_STREET_CLASS && road.path.length >= 2)
    .map((road) => pathOf(project, road.path))
    .join("");
}

function areaPaths(data: InkMapData, project: Project) {
  return data.areas.map((area) => pathOf(project, area.ring, true)).join("");
}

function useSnowPaths(data: InkMapData, scenario: Scenario | null, project: Project) {
  const windows = useMemo(() => roadWindows(data, closureRules(scenario, data)), [data, scenario]);
  return useMemo(
    () => ({ streets: streetGroups(data, windows, project), minor: minorPaths(data, project), areas: areaPaths(data, project), scale: pixelsPerMeter(project) }),
    [data, windows, project],
  );
}

// How far a street has gone under: nothing while open, all of it an hour and a half after it closes.
function erasedBy(window: ClosureWindow, minutes: number) {
  if (!isClosed(window, minutes)) return 0;
  return Math.min(1, (minutes - window.closedAt) / ERASE_MINUTES);
}

function Street({ street, minutes }: { street: StreetGroup; minutes: number }) {
  const shown = 1 - erasedBy(street.window, minutes);
  const rutWidth = Math.max(1.2, street.width * 0.8);
  return (
    <g>
      <path d={street.d} fill="none" stroke="var(--map-paper)" strokeWidth={street.width + 2} strokeLinecap="round" />
      {shown > 0 && <path d={street.d} fill="none" stroke="var(--map-ink)" strokeOpacity={0.8 * shown} strokeWidth={rutWidth} strokeLinecap="round" />}
      {shown > 0 && rutWidth > 3.5 && <path d={street.d} fill="none" stroke="var(--map-paper)" strokeWidth={rutWidth - 1.6} strokeLinecap="round" />}
    </g>
  );
}

// The flakes' tile slides a whole number of tiles each loop, so the drift never jumps.
const FLAKE_TILE = 180;
const FLAKES = [
  { x: 23, y: 41, r: 2.6 },
  { x: 118, y: 17, r: 1.5 },
  { x: 71, y: 112, r: 1.9 },
  { x: 152, y: 139, r: 1.3 },
];

function driftTo([east, north]: [number, number]) {
  return `${Math.round(east * 2) * FLAKE_TILE} ${Math.round(-north * 2) * FLAKE_TILE}`;
}

export function BlizzardPaper({ data, scenario, minutes, project }: PaperHazardProps) {
  const id = useId().replace(/:/g, "");
  const weather = blizzardWeather(scenario, minutes, data.origin);
  const paths = useSnowPaths(data, scenario, project);
  const buried = Math.min(1, Math.max(0, (weather.depthMeters - 0.02) / 0.28));
  const snowy = weather.depthMeters > 0.01;
  return (
    <g>
      <defs>
        <pattern id={`${id}-flakes`} width={FLAKE_TILE} height={FLAKE_TILE} patternUnits="userSpaceOnUse">
          {FLAKES.map((flake, i) => (
            <circle key={i} cx={flake.x} cy={flake.y} r={flake.r} fill="var(--map-paper)" stroke="var(--map-ink)" strokeWidth={0.6} />
          ))}
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to={driftTo(weather.windToward)} dur="9s" repeatCount="indefinite" />
        </pattern>
      </defs>
      <path d={paths.areas} fill="var(--map-paper)" fillOpacity={0.9 * buried} />
      <path d={paths.minor} fill="none" stroke="var(--map-paper)" strokeOpacity={buried} strokeWidth={Math.max(2, 4 * paths.scale)} />
      {snowy && paths.streets.map((street) => <Street key={street.key} street={street} minutes={minutes} />)}
      <rect x={-10000} y={-10000} width={30000} height={30000} fill="var(--map-paper)" opacity={MOST_VEIL * weather.whiteout} />
      <rect x={-10000} y={-10000} width={30000} height={30000} fill={`url(#${id}-flakes)`} opacity={weather.snowfall} />
    </g>
  );
}
