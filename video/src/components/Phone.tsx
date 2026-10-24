import { Check } from "@phosphor-icons/react";
import { useMemo } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { Run, XY } from "../data/scene";
import { bounds, pathD, progress } from "../geometry";
import { color, ease, SAFE, type } from "../theme";

const SCREEN = { width: 352, height: 430 };

function useMiniRoute(run: Run) {
  return useMemo(() => {
    const box = bounds(run.path);
    const scale = Math.min((SCREEN.width - 60) / (box.x1 - box.x0), (SCREEN.height - 60) / (box.y1 - box.y0));
    const fit = ([x, y]: XY): XY => [30 + (x - box.x0) * scale, 30 + (y - box.y0) * scale];
    return { d: pathD(run.path.map(fit)), stops: run.stops.map((stop) => ({ ...stop, at: fit(stop.at) })), start: fit(run.path[0]) };
  }, [run]);
}

function AcceptButton({ tapAt }: { tapAt: number }) {
  const frame = useCurrentFrame();
  const press = interpolate(frame, [tapAt - 3, tapAt, tapAt + 6], [1, 0.94, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const done = progress(frame, tapAt + 2, tapAt + 14, ease.overshoot);
  const ripple = progress(frame, tapAt, tapAt + 20, ease.standard);
  return (
    <div style={{ position: "relative", height: 104, borderRadius: 26, background: color.onPanel, color: color.panel, display: "flex", alignItems: "center", justifyContent: "center", scale: `${press}`, overflow: "hidden" }}>
      {ripple > 0 && ripple < 1 && <div style={{ position: "absolute", width: 600 * ripple, height: 600 * ripple, borderRadius: "50%", background: color.panel, opacity: 0.18 * (1 - ripple) }} />}
      {done > 0 ? <Check size={52} weight="bold" style={{ scale: `${done}` }} /> : <span style={{ ...type.display, fontSize: 44 }}>Accept</span>}
    </div>
  );
}

// The finger: comes in from below, settles on the button, presses.
function Touch({ tapAt }: { tapAt: number }) {
  const frame = useCurrentFrame();
  const arrive = progress(frame, tapAt - 22, tapAt - 2, ease.outQuint);
  const leave = progress(frame, tapAt + 8, tapAt + 22, ease.standard);
  const size = interpolate(frame, [tapAt - 3, tapAt, tapAt + 6], [64, 48, 64], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (arrive <= 0 || leave >= 1) return null;
  return (
    <div style={{ position: "absolute", left: "50%", bottom: 64, width: size, height: size, marginLeft: -size / 2, marginBottom: -size / 2 + 52, borderRadius: "50%", background: "rgba(255,255,255,0.5)", boxShadow: "0 6px 18px rgba(0,0,0,0.35)", translate: `${(1 - arrive) * 120}px ${(1 - arrive) * 260}px`, opacity: arrive * (1 - leave) }} />
  );
}

// The driver's page, reduced to the offer and the one thing the driver does with it.
export function Phone({ run, enter, tapAt, exit }: { run: Run; enter: number; tapAt: number; exit: number }) {
  const frame = useCurrentFrame();
  const mini = useMiniRoute(run);
  const slide = progress(frame, enter, enter + 22, ease.outQuint) - progress(frame, exit, exit + 16, ease.inOut);
  const drawn = progress(frame, enter + 12, enter + 44, ease.inOut);
  const solid = progress(frame, tapAt + 2, tapAt + 14, ease.standard);
  if (slide <= 0) return null;
  return (
    <div style={{ position: "absolute", right: SAFE + 40, top: 140, width: 400, height: 800, borderRadius: 60, background: color.night, padding: 16, boxShadow: "0 40px 80px rgba(20,12,8,0.45), 0 8px 20px rgba(20,12,8,0.3)", translate: `${(1 - slide) * 620}px 0`, rotate: `${(1 - slide) * 6}deg` }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 46, background: color.panel, padding: "64px 24px 24px", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden" }}>
        <svg width={SCREEN.width} height={SCREEN.height}>
          <path d={mini.d} fill="none" stroke={color.onPanelMuted} strokeWidth={3} strokeDasharray="8 7" strokeDashoffset={-frame} opacity={(1 - solid) * 0.9 * drawn} pathLength={1000} />
          <path d={mini.d} fill="none" stroke={color.onPanel} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={`${drawn} 1`} opacity={solid} />
          {mini.stops.map((stop, i) => (
            <circle key={i} cx={stop.at[0]} cy={stop.at[1]} r={(stop.lift ? 9 : 7) * Math.min(1, Math.max(0, drawn * mini.stops.length - i))} fill={color.signal} stroke={color.panel} strokeWidth={3} />
          ))}
          <rect x={mini.start[0] - 11} y={mini.start[1] - 8} width={22} height={16} fill={color.onPanel} opacity={drawn > 0 ? 1 : 0} />
        </svg>
        <AcceptButton tapAt={tapAt} />
        <Touch tapAt={tapAt} />
      </div>
    </div>
  );
}
