import { interpolate, useCurrentFrame } from "remotion";
import { progress } from "../geometry";
import { color, ease, type } from "../theme";

// The app bar's mark: a red square, then the name sliding out from behind it.
export function BrandMark({ start, size = 150 }: { start: number; size?: number }) {
  const frame = useCurrentFrame();
  const square = progress(frame, start, start + 14, ease.overshoot);
  const name = progress(frame, start + 8, start + 26, ease.outQuint);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.22 }}>
      <div style={{ width: size * 0.62, height: size * 0.62, background: color.signal, scale: `${Math.max(0, square)}`, rotate: `${interpolate(square, [0, 1], [-45, 0])}deg` }} />
      <div style={{ overflow: "hidden" }}>
        <div style={{ ...type.display, fontSize: size, color: color.ink, translate: `${(1 - name) * -105}% 0` }}>Doorstep</div>
      </div>
    </div>
  );
}
