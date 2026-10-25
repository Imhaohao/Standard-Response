import { useMemo } from "react";
import { ROAD_WIDTH, type InkMapData, type Point } from "../../data";
import type { Scenario } from "../../scenario";
import type { PaperHazardProps } from "../types";
import { SNOW_WHITE_CSS } from "./palette";
import { closureRules, isClosed, MOST_STREET_CLASS, roadWindows, type ClosureWindow } from "./roads";
import { blizzardWeather } from "./weather";

// The blizzard on the flat map, drawn the way the 3D map draws it: as the snow deepens the cream paper
// turns snow white and the area tints and minor paths fade into it; every street is overdrawn, open ones as
// a dark double line of ruts, closed ones fading over the hour and a half after they shut to a faint
// ghost. The flat map has no buildings, so that ghost of the street grid is what keeps it a town. A
// light veil comes and goes with visibility.

type Project = PaperHazardProps["project"];

const ERASE_MINUTES = 90;
const MOST_VEIL = 0.22;
const OPEN_OPACITY = 0.8;
const GHOST_OPACITY = 0.2;

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
  const erased = erasedBy(street.window, minutes);
  const rutWidth = Math.max(1.2, street.width * 0.8);
  const width = erased < 1 ? rutWidth : 1;
  return (
    <g>
      <path d={street.d} fill="none" stroke={SNOW_WHITE_CSS} strokeWidth={street.width + 2} strokeLinecap="round" />
      <path d={street.d} fill="none" stroke="var(--map-ink)" strokeOpacity={OPEN_OPACITY - (OPEN_OPACITY - GHOST_OPACITY) * erased} strokeWidth={width} strokeLinecap="round" />
      {width > 3.5 && <path d={street.d} fill="none" stroke={SNOW_WHITE_CSS} strokeWidth={width - 1.6} strokeLinecap="round" />}
    </g>
  );
}

export function BlizzardPaper({ data, scenario, minutes, project }: PaperHazardProps) {
  const weather = blizzardWeather(scenario, minutes, data.origin);
  const paths = useSnowPaths(data, scenario, project);
  const buried = Math.min(1, Math.max(0, (weather.depthMeters - 0.02) / 0.28));
  return (
    <g>
      <rect x={-10000} y={-10000} width={30000} height={30000} fill={SNOW_WHITE_CSS} opacity={0.85 * buried} />
      <path d={paths.areas} fill={SNOW_WHITE_CSS} fillOpacity={0.9 * buried} />
      <path d={paths.minor} fill="none" stroke={SNOW_WHITE_CSS} strokeOpacity={buried} strokeWidth={Math.max(2, 4 * paths.scale)} />
      {weather.depthMeters > 0.01 && paths.streets.map((street) => <Street key={street.key} street={street} minutes={minutes} />)}
      <rect x={-10000} y={-10000} width={30000} height={30000} fill={SNOW_WHITE_CSS} opacity={MOST_VEIL * weather.whiteout} />
    </g>
  );
}
