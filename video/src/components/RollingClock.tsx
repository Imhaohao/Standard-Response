import { interpolate, useCurrentFrame } from "remotion";
import { color, ease, type } from "../theme";

const clock = (minutes: number) => {
  const hours = Math.floor(minutes / 60) % 12 || 12;
  return `${hours}:${String(Math.floor(minutes) % 60).padStart(2, "0")}`;
};

// An odometer: each digit that changes rolls up out of the way of the next one.
export function RollingClock({ from, to, start, end, size = 168 }: { from: number; to: number; start: number; end: number; size?: number }) {
  const frame = useCurrentFrame();
  const minutes = interpolate(frame, [start, end], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.inOut });
  const whole = Math.floor(minutes);
  const roll = whole >= to ? 0 : ease.standard(Math.min(1, Math.max(0, (minutes - whole - 0.45) / 0.55)));
  const now = clock(whole);
  const next = clock(Math.min(whole + 1, to));
  return (
    <div style={{ ...type.figure, fontSize: size, color: color.onPanel, display: "flex", alignItems: "baseline", gap: "0.18em" }}>
      <span style={{ display: "flex", height: "1em", overflow: "hidden" }}>
        {[...next.padStart(now.length)].map((digit, i) => (
          <span key={i} style={{ display: "flex", flexDirection: "column", translate: `0 ${now[i] === digit ? 0 : -roll}em` }}>
            <span style={{ height: "1em" }}>{now[i]}</span>
            <span style={{ height: "1em" }}>{digit}</span>
          </span>
        ))}
      </span>
      <span style={{ fontSize: "0.42em", color: color.onPanelMuted }}>am</span>
    </div>
  );
}
