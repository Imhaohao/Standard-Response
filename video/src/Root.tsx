import { Composition } from "remotion";
import { DURATION, Promo } from "./Promo";
import { FPS, HEIGHT, WIDTH } from "./theme";

export const RemotionRoot: React.FC = () => {
  return <Composition id="Promo" component={Promo} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />;
};
