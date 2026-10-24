import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill } from "remotion";
import { Grain } from "./components/Grain";
import { Brand } from "./scenes/Brand";
import { Dark } from "./scenes/Dark";
import { End } from "./scenes/End";
import { Night } from "./scenes/Night";
import { With } from "./scenes/With";
import { Without } from "./scenes/Without";

export const SCENES = { night: 105, without: 225, dark: 54, brand: 46, with: 500, end: 80 };
const FADES = [20, 10, 20];
export const DURATION = Object.values(SCENES).reduce((a, b) => a + b, 0) - FADES.reduce((a, b) => a + b, 0);

export function Promo() {
  return (
    <AbsoluteFill style={{ background: "black" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENES.night}>
          <Night duration={SCENES.night} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: FADES[0] })} />
        <TransitionSeries.Sequence durationInFrames={SCENES.without}>
          <Without />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence durationInFrames={SCENES.dark}>
          <Dark duration={SCENES.dark} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: FADES[1] })} />
        <TransitionSeries.Sequence durationInFrames={SCENES.brand}>
          <Brand duration={SCENES.brand} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence durationInFrames={SCENES.with}>
          <With />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: FADES[2] })} />
        <TransitionSeries.Sequence durationInFrames={SCENES.end}>
          <End />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Grain />
    </AbsoluteFill>
  );
}
