import { AbsoluteFill } from "remotion";
import { Headline } from "../components/Headline";
import { color } from "../theme";

export function Dark({ duration }: { duration: number }) {
  return (
    <AbsoluteFill style={{ background: color.night }}>
      <Headline start={2} end={duration - 2} words="Nothing connected them." size={120} align="center" tone="bare" />
    </AbsoluteFill>
  );
}
