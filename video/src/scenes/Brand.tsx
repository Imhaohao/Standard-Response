import { AbsoluteFill, useCurrentFrame } from "remotion";
import { BrandMark } from "../components/BrandMark";
import { progress } from "../geometry";
import { color, ease } from "../theme";

// The turn: the mark arrives, then its signal goes out as the first ring of calls.
export function Brand({ duration }: { duration: number }) {
  const frame = useCurrentFrame();
  const ring = progress(frame, duration - 18, duration, ease.standard);
  return (
    <AbsoluteFill style={{ background: color.canvas, justifyContent: "center", alignItems: "center" }}>
      <BrandMark start={2} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
        <div style={{ width: 80 + ring * 2400, height: 80 + ring * 2400, borderRadius: "50%", boxShadow: `0 0 0 ${3 + ring * 6}px ${color.signal}`, opacity: ring > 0 ? 1 - ring * 0.6 : 0 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
