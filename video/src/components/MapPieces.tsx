import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { Front, XY } from "../data/scene";
import { pathD, progress } from "../geometry";
import { color, ease, HEIGHT, WIDTH } from "../theme";
import { useZoom } from "./Camera";

export function PaperPlate() {
  return <Img src={staticFile("plates/paper.jpg")} style={{ position: "absolute", inset: 0, width: WIDTH, height: HEIGHT }} />;
}

// The site's vehicle mark, an ink block on a paper casing, dropped in with a little overshoot.
export function Van({ at, appear, size = 1 }: { at: XY; appear: number; size?: number }) {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  const drop = progress(frame, appear, appear + 14, ease.overshoot);
  const s = (size * 2.2) / zoom;
  if (frame < appear) return null;
  return (
    <g transform={`translate(${at[0]} ${at[1] - (1 - drop) * 24 / zoom}) scale(${s * Math.max(0, drop)})`} opacity={Math.min(1, drop * 2)}>
      <rect x={-12} y={-8.5} width={24} height={17} fill={color.mapPaper} />
      <rect x={-10.5} y={-7} width={21} height={14} fill={color.mapInk} />
      <rect x={4} y={-4.5} width={4} height={9} fill={color.mapPaper} opacity={0.5} />
    </g>
  );
}

// Waiting: a slow ring that goes out and comes back, never reaching anyone.
export function IdleRing({ at, phase }: { at: XY; phase: number }) {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  const t = ((frame + phase) % 60) / 60;
  return <circle cx={at[0]} cy={at[1]} r={(14 + t * 26) / zoom} fill="none" stroke={color.mapInk} strokeWidth={1.4 / zoom} opacity={(1 - t) * 0.35} />;
}

// The fire, drawn the way the flat map draws it: each front a faint wash, the next one dashed.
export function Fronts({ fronts, start, end }: { fronts: Front[]; start: number; end: number }) {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  const reached = interpolate(frame, [start, end], [0, fronts.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <g>
      {fronts.map((front, index) => {
        const shown = Math.min(1, Math.max(0, reached - index));
        if (shown <= 0) return null;
        const d = front.rings.map((ring) => pathD(ring, true)).join("");
        const leading = index === Math.min(fronts.length - 1, Math.floor(reached));
        return (
          <g key={front.minutes}>
            <path d={d} fill={color.signal} fillOpacity={leading ? 0.1 * shown : 0} stroke={color.signal} strokeOpacity={(leading ? 0.7 : 0.22) * shown} strokeWidth={(leading ? 2.2 : 1.2) / zoom} />
            {shown < 1 && <path d={d} fill="none" stroke={color.signal} strokeWidth={2.2 / zoom} strokeDasharray={`${8 / zoom} ${6 / zoom}`} opacity={shown} />}
          </g>
        );
      })}
    </g>
  );
}

// A call going out from one place: rings that leave the dot and fade.
export function Ripples({ at, start, count = 3, every = 10, reach = 34, width = 2.4, tint = color.signal }: { at: XY; start: number; count?: number; every?: number; reach?: number; width?: number; tint?: string }) {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const t = progress(frame, start + i * every, start + i * every + 26, ease.standard);
        if (t <= 0 || t >= 1) return null;
        return <circle key={i} cx={at[0]} cy={at[1]} r={(6 + t * reach) / zoom} fill="none" stroke={tint} strokeWidth={width / zoom} opacity={1 - t} />;
      })}
    </g>
  );
}

// A pickup: a dot, or a square when it takes a lift, like the rescue map.
export function Pin({ at, lift, scale, tint = color.signal }: { at: XY; lift: boolean; scale: number; tint?: string }) {
  const zoom = useZoom();
  const size = (lift ? 6.5 : 5.5) / zoom;
  if (scale <= 0) return null;
  return (
    <g transform={`translate(${at[0]} ${at[1]}) scale(${scale})`}>
      <circle r={size + 6 / zoom} fill={tint} fillOpacity={0.14} />
      {lift ? (
        <rect x={-size} y={-size} width={size * 2} height={size * 2} fill={tint} stroke={color.mapPaper} strokeWidth={2 / zoom} />
      ) : (
        <circle r={size} fill={tint} stroke={color.mapPaper} strokeWidth={2 / zoom} />
      )}
    </g>
  );
}
