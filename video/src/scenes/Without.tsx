import { AbsoluteFill } from "remotion";
import { Camera, MapLayer, Shot } from "../components/Camera";
import { Vignette } from "../components/Grain";
import { Headline } from "../components/Headline";
import { Households } from "../components/Households";
import { Fronts, IdleRing, PaperPlate, Van } from "../components/MapPieces";
import { RollingClock } from "../components/RollingClock";
import { scene } from "../data/scene";
import { centroid } from "../geometry";

const depot = centroid(scene.runs.map((run) => run.at));

const SHOTS: Shot[] = [
  { frame: 0, focus: [depot[0] + 40, depot[1] - 30], zoom: 1.9 },
  { frame: 100, focus: [depot[0] + 70, depot[1] - 50], zoom: 1.7 },
  { frame: 200, focus: [960, 540], zoom: 1.02 },
  { frame: 225, focus: [960, 520], zoom: 1 },
];

// The vans sit ready from 4am. Nobody calls the people who can't leave, and the fire comes on.
export function Without() {
  return (
    <AbsoluteFill>
      <Camera shots={SHOTS}>
        <PaperPlate />
        <MapLayer>
          <Fronts fronts={scene.fronts} start={120} end={215} />
          <Households households={scene.households} appear={110} />
          {scene.runs.map((run, i) => (
            <g key={run.label}>
              <IdleRing at={run.at} phase={i * 11} />
              <Van at={run.at} appear={8 + i * 5} />
            </g>
          ))}
        </MapLayer>
      </Camera>
      <Vignette strength={0.18} />
      <Headline start={14} end={104} words="The vans were ready at 4 am." />
      <Headline start={120} end={222} words="No one called them." size={72} lead={<RollingClock from={240} to={363} start={126} end={206} />} />
    </AbsoluteFill>
  );
}
