import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Camera, MapLayer, Shot, useZoom } from "../components/Camera";
import { Vignette } from "../components/Grain";
import { Headline } from "../components/Headline";
import { Households, useCallTimes } from "../components/Households";
import { PaperPlate, Pin, Ripples, Van } from "../components/MapPieces";
import { Phone } from "../components/Phone";
import { RunRoute } from "../components/RunRoute";
import { routedRuns, scene, XY } from "../data/scene";
import { bounds, centroid, pathD, progress } from "../geometry";
import { color, ease, type } from "../theme";

// Beats, in frames from the start of this scene.
const CALL = { start: 8, end: 100 };
const MATCH = 135;
const ACCEPT = 285;
const TAP = ACCEPT + 50;
const REROUTE = 390;
const STAMP = REROUTE + 38;
const END = 500;

const WAVE = { origin: centroid(scene.fronts[0].rings[0]), start: CALL.start, end: CALL.end };
const featured = routedRuns.find((run) => run.label === "Van 7") ?? routedRuns[0];
const { reroute } = scene;

function framing(points: XY[], width: number, height: number, [min, max]: [number, number]) {
  const box = bounds(points);
  const zoom = Math.min(max, Math.max(min, Math.min(width / (box.x1 - box.x0), height / (box.y1 - box.y0))));
  return { center: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2] as XY, zoom };
}

const all = framing(routedRuns.flatMap((run) => run.path), 1700, 900, [1, 1.3]);
const offer = framing(featured.path, 900, 540, [1.1, 2.6]);
const closure = framing([...reroute.before, ...reroute.after], 760, 460, [1.6, 3.2]);

const SHOTS: Shot[] = [
  { frame: 0, focus: [960, 540], zoom: 1 },
  { frame: MATCH, focus: [960, 540], zoom: 1.04 },
  { frame: MATCH + 30, focus: all.center, zoom: all.zoom },
  { frame: ACCEPT, focus: all.center, zoom: all.zoom * 1.04 },
  { frame: ACCEPT + 24, focus: [offer.center[0] + 330 / offer.zoom, offer.center[1] + 130 / offer.zoom], zoom: offer.zoom },
  { frame: REROUTE, focus: [offer.center[0] + 320 / offer.zoom, offer.center[1] + 130 / offer.zoom], zoom: offer.zoom * 1.05 },
  { frame: REROUTE + 26, focus: [closure.center[0], closure.center[1] + 90 / closure.zoom], zoom: closure.zoom },
  { frame: END, focus: [closure.center[0], closure.center[1] + 90 / closure.zoom], zoom: closure.zoom * 1.06 },
];

function CallCount({ calledAt }: { calledAt: number[] }) {
  const frame = useCurrentFrame();
  const count = calledAt.filter((at) => frame >= at).length;
  return <div style={{ ...type.figure, fontSize: 168, color: color.onPanel }}>{count.toLocaleString("en-US")}</div>;
}

function CallWave() {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  const t = progress(frame, WAVE.start, WAVE.end + 10, (x) => x);
  if (t <= 0 || t >= 1) return null;
  const r = t * 2600;
  return (
    <g opacity={1 - t * 0.7}>
      <circle cx={WAVE.origin[0]} cy={WAVE.origin[1]} r={r} fill="none" stroke={color.signal} strokeWidth={46 / zoom} opacity={0.07} />
      <circle cx={WAVE.origin[0]} cy={WAVE.origin[1]} r={r} fill="none" stroke={color.signal} strokeWidth={2.4 / zoom} />
    </g>
  );
}

function Runs() {
  const frame = useCurrentFrame();
  const others = 1 - progress(frame, ACCEPT, ACCEPT + 16, ease.standard) * 0.86;
  const gone = 1 - progress(frame, REROUTE, REROUTE + 14, ease.standard);
  return (
    <g opacity={gone}>
      {routedRuns.map((run, i) => {
        const isFeatured = run === featured;
        const draw: [number, number] = [MATCH + 18 + i * 7, MATCH + 105 + i * 7];
        return isFeatured ? (
          <RunRoute key={run.label} id={`run-${i}`} run={run} draw={draw} committedAt={TAP + 2} drive={[TAP + 10, REROUTE + 10, 0.32]} />
        ) : (
          <RunRoute key={run.label} id={`run-${i}`} run={run} draw={draw} opacity={others} />
        );
      })}
      {scene.runs.map((run, i) => (run === featured ? null : <Van key={run.label} at={run.at} appear={MATCH + 6 + i * 4} />))}
    </g>
  );
}

function ClosedRoad() {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  const shown = progress(frame, REROUTE + 4, REROUTE + 16, ease.standard);
  const before = progress(frame, REROUTE + 6, REROUTE + 30, ease.inOut);
  const stamp = progress(frame, STAMP, STAMP + 10, ease.overshoot);
  const stale = progress(frame, STAMP + 4, STAMP + 18, ease.standard);
  const detour = progress(frame, STAMP + 12, STAMP + 42, ease.inOut);
  const mid = centroid(reroute.closed);
  if (shown <= 0) return null;
  return (
    <g opacity={shown}>
      <path d={pathD(reroute.before)} fill="none" stroke={color.mapPaper} strokeWidth={10 / zoom} strokeLinecap="round" pathLength={1} strokeDasharray={`${before} 1`} />
      <path d={pathD(reroute.before)} fill="none" stroke={color.mapInk} strokeWidth={5 / zoom} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={stale > 0 ? "0.012 0.012" : `${before} 1`} opacity={1 - stale * 0.65} />
      <path d={pathD(reroute.after)} fill="none" stroke={color.mapPaper} strokeWidth={11 / zoom} strokeLinecap="round" pathLength={1} strokeDasharray={`${detour} 1`} />
      <path d={pathD(reroute.after)} fill="none" stroke={color.mapInk} strokeWidth={6 / zoom} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={`${detour} 1`} />
      {stamp > 0 && (
        <g transform={`translate(${mid[0]} ${mid[1]}) scale(${interpolate(stamp, [0, 1], [2.2, 1])}) translate(${-mid[0]} ${-mid[1]})`} opacity={Math.min(1, stamp * 1.5)}>
          <path d={pathD(reroute.closed)} fill="none" stroke={color.mapPaper} strokeWidth={20 / zoom} strokeLinecap="round" />
          <path d={pathD(reroute.closed)} fill="none" stroke={color.signal} strokeWidth={12 / zoom} strokeLinecap="round" />
        </g>
      )}
      <Pin at={reroute.to} lift={false} scale={1.8} />
      <Ripples at={reroute.to} start={STAMP + 20} count={5} every={9} reach={70} width={3.2} />
      <Van at={reroute.from} appear={REROUTE + 4} />
    </g>
  );
}

function useShake(): XY {
  const frame = useCurrentFrame();
  const t = frame - STAMP - 6;
  if (t < 0 || t > 10) return [0, 0];
  const amp = 7 * (1 - t / 10);
  return [Math.sin(t * 2.7) * amp, Math.cos(t * 3.3) * amp];
}

// The same town with a coordinator: every household called, needs matched to vans that fit,
// a driver's yes before anyone is promised, and the truth told fast when a road closes.
export function With() {
  const calledAt = useCallTimes(scene.households, WAVE);
  const frame = useCurrentFrame();
  const quiet = 1 - progress(frame, REROUTE, REROUTE + 16, ease.standard) * 0.7;
  return (
    <AbsoluteFill>
      <Camera shots={SHOTS} shake={useShake()}>
        <PaperPlate />
        <MapLayer>
          <g opacity={quiet}>
            <Households households={scene.households} appear={-40} calledAt={calledAt} keep={() => false} thinFrom={MATCH} />
          </g>
          <CallWave />
          <Runs />
          <ClosedRoad />
        </MapLayer>
      </Camera>
      <Vignette strength={0.16} />
      <Headline start={14} end={MATCH - 4} words="households called." size={72} lead={<CallCount calledAt={calledAt} />} />
      <Headline start={MATCH + 14} end={ACCEPT - 4} words="Matched to a van that can lift." />
      <Headline start={ACCEPT + 8} end={REROUTE - 4} words="A driver says yes first." />
      <Phone run={featured} enter={ACCEPT + 4} tapAt={TAP} exit={REROUTE - 6} />
      <Headline start={STAMP + 2} end={END - 2} words="Road closed. The rider hears first." />
    </AbsoluteFill>
  );
}
