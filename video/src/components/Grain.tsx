import { AbsoluteFill, useCurrentFrame } from "remotion";
import { HEIGHT, WIDTH } from "../theme";

// Paper tooth over everything, reseeded each frame so it reads as film, not a texture.
export function Grain({ strength = 0.07 }: { strength?: number }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "multiply", opacity: strength }}>
      <svg width={WIDTH} height={HEIGHT}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={frame % 24} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width={WIDTH} height={HEIGHT} filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
}

export function Vignette({ strength = 0.35, tint = "0,0,0" }: { strength?: number; tint?: string }) {
  return (
    <AbsoluteFill
      style={{ pointerEvents: "none", background: `radial-gradient(ellipse 75% 70% at 50% 45%, rgba(${tint},0) 55%, rgba(${tint},${strength}) 100%)` }}
    />
  );
}
