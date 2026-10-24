import { useMemo } from "react";
import { interpolate, interpolateColors, useCurrentFrame } from "remotion";
import type { Household, XY } from "../data/scene";
import { jitter, progress } from "../geometry";
import { color, ease, kindColor } from "../theme";
import { useZoom } from "./Camera";

export type CallWave = { origin: XY; start: number; end: number };

// When the wave of calls reaches each household, by distance from where the warning starts.
export function useCallTimes(households: Household[], wave: CallWave) {
  return useMemo(() => {
    const distances = households.map(({ at }) => Math.hypot(at[0] - wave.origin[0], at[1] - wave.origin[1]));
    const [near, far] = [Math.min(...distances), Math.max(...distances)];
    return distances.map((distance, i) => wave.start + ((distance - near) / (far - near)) * (wave.end - wave.start) + jitter(i) * 6);
  }, [households, wave]);
}

type Props = { households: Household[]; appear: number; calledAt?: number[]; keep?: (kind: number) => boolean; thinFrom?: number };

function dotStyle(frame: number, kind: number, calledAt: number | undefined) {
  if (calledAt === undefined || frame < calledAt) return { fill: color.unknown, r: 3.4, ring: 0 };
  const t = frame - calledAt;
  const pop = interpolate(t, [0, 5, 14], [3.4, 7, 4.6], { extrapolateRight: "clamp", easing: ease.outQuint });
  return { fill: interpolateColors(t, [0, 6], [color.unknown, kindColor[kind]]), r: pop, ring: t < 22 ? t / 22 : 0 };
}

export function Households({ households, appear, calledAt, keep, thinFrom }: Props) {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  const thin = thinFrom === undefined ? 0 : progress(frame, thinFrom, thinFrom + 20, ease.standard);
  return (
    <g>
      {households.map(({ at, kind }, i) => {
        const shown = progress(frame, appear + jitter(i + 3) * 40, appear + jitter(i + 3) * 40 + 12);
        if (shown <= 0) return null;
        const style = dotStyle(frame, kind, calledAt?.[i]);
        const fade = keep && !keep(kind) ? 1 - thin * 0.8 : 1;
        return (
          <g key={i} opacity={shown * fade}>
            {style.ring > 0 && (
              <circle cx={at[0]} cy={at[1]} r={(5 + style.ring * 18) / zoom} fill="none" stroke={kindColor[kind]} strokeWidth={1.8 / zoom} opacity={1 - style.ring} />
            )}
            <circle cx={at[0]} cy={at[1]} r={style.r / zoom} fill={style.fill} stroke={color.mapPaper} strokeWidth={1.1 / zoom} />
          </g>
        );
      })}
    </g>
  );
}
