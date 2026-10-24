import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Headline } from "../components/Headline";
import { RollingClock } from "../components/RollingClock";
import { Vignette } from "../components/Grain";
import { progress } from "../geometry";
import { color, ease } from "../theme";

const PLATES = [0, 1, 2, 3, 4, 5, 6, 7];

// 3:25am in the 3D ink map: the fire is still a spot in the hills, and it grows while we watch.
export function Night({ duration }: { duration: number }) {
  const frame = useCurrentFrame();
  const step = interpolate(frame, [0, duration], [0, PLATES.length - 1], { extrapolateRight: "clamp" });
  const push = progress(frame, 0, duration, ease.standard);
  const dawn = progress(frame, 0, 40, ease.standard);
  return (
    <AbsoluteFill style={{ background: color.night }}>
      <AbsoluteFill style={{ scale: `${1.32 - push * 0.16}`, translate: `${-140 + push * 90}px ${150 - push * 60}px` }}>
        {PLATES.map((plate) => {
          const opacity = Math.min(1, Math.max(0, 1 - Math.abs(step - plate)));
          if (opacity === 0) return null;
          return <Img key={plate} src={staticFile(`plates/fire_${String(plate).padStart(2, "0")}.jpg`)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity }} />;
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: color.night, opacity: 0.62 - dawn * 0.22, mixBlendMode: "multiply" }} />
      <Vignette strength={0.55} />
      <Headline start={14} end={duration - 4} words="Evacuation order." size={72} lead={<RollingClock from={205} to={205} start={0} end={1} />} />
    </AbsoluteFill>
  );
}
