import { AbsoluteFill, useCurrentFrame } from "remotion";
import { BrandMark } from "../components/BrandMark";
import { progress } from "../geometry";
import { color, type } from "../theme";

export function End() {
  const frame = useCurrentFrame();
  const link = progress(frame, 22, 40);
  return (
    <AbsoluteFill style={{ background: color.canvas, justifyContent: "center", alignItems: "center", gap: 56 }}>
      <BrandMark start={4} size={170} />
      <div style={{ ...type.label, fontSize: 40, color: color.unreachable, opacity: link, translate: `0 ${(1 - link) * 16}px` }}>github.com/trycua/cua</div>
    </AbsoluteFill>
  );
}
