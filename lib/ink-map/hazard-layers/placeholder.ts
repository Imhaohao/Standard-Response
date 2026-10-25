import * as THREE from "three";
import type { HazardKind } from "../../cities";
import { arrivalIndex, arrivalTexture, ArrivalIndex, impactAt, NO_IMPACT } from "./arrival";
import { ARRIVAL_GLSL, FULLSCREEN_HEADER, GBUFFER_GLSL, GROUND_HATCH_GLSL } from "./glsl";
import type { FullscreenPass, HazardLayer, HazardLayerContext } from "./types";

// The renderer for a hazard without one of its own: hatching over the ground the hazard has reached,
// drifting slowly so the every-frame path is exercised, with a firm line on its edge. Each hazard that
// uses it picks a colour (a palette uniform from context.shared) and a hatch angle.
const PLACEHOLDER_FRAGMENT = `
${FULLSCREEN_HEADER}
${GBUFFER_GLSL}
${ARRIVAL_GLSL}
${GROUND_HATCH_GLSL}
uniform vec3 uTint;
uniform float uMinutes;
uniform float uAngle;
uniform float uTime;

void main() {
  if (isSky(vUv)) { fragColor = vec4(0.0); return; }
  vec2 mapXY = mapPoint(vUv);
  float minutes = arrivalAt(mapXY);
  float reached = 1.0 - smoothstep(uMinutes - 1.0, uMinutes, minutes);
  vec2 drift = vec2(cos(uAngle), sin(uAngle)) * uTime * 3.0;
  float lines = groundHatch(mapXY + drift, 7.0 * uPixelRatio, uAngle, 0.22);
  float width = max(fwidth(minutes), 1e-3);
  float edge = (1.0 - smoothstep(0.6, 1.8, abs(minutes - uMinutes) / width)) * step(width, 60.0) * step(minutes, uArrivalLast + 1.0);
  float wash = reached * 0.16;
  float alpha = max(max(wash, lines * reached * 0.7), edge * 0.9);
  fragColor = vec4(uTint, alpha);
}
`;

export class PlaceholderLayer implements HazardLayer {
  readonly animates = true;
  private pass: FullscreenPass | null = null;
  private arrival: ReturnType<typeof arrivalTexture> | null = null;
  private index: ArrivalIndex | null = null;

  constructor(
    readonly kind: HazardKind,
    private context: HazardLayerContext,
    { tint, angle }: { tint: THREE.Vector3; angle: number },
  ) {
    if (!context.field) return;
    this.arrival = arrivalTexture(context.field);
    const { shared } = context;
    this.pass = context.fullscreen(
      PLACEHOLDER_FRAGMENT,
      {
        tDepth: shared.tDepth,
        tShade: shared.tShade,
        tId: shared.tId,
        uInvProjection: shared.uInvProjection,
        uCameraWorld: shared.uCameraWorld,
        uBaseElevation: shared.uBaseElevation,
        uPatternScale: shared.uPatternScale,
        uPixelRatio: shared.uPixelRatio,
        uTime: shared.uTime,
        tArrival: { value: this.arrival.texture },
        uArrivalRegion: { value: this.arrival.region },
        uArrivalLast: { value: this.arrival.last },
        uTint: { value: tint },
        uAngle: { value: angle },
        uMinutes: { value: 0 },
      },
      { blend: true },
    );
  }

  setMinutes(minutes: number) {
    if (this.pass) this.pass.material.uniforms.uMinutes.value = minutes;
  }

  drawScreen() {
    this.pass?.draw();
  }

  impact(minutes: number) {
    if (!this.context.field) return NO_IMPACT;
    this.index ??= arrivalIndex(this.context.data, this.context.field);
    return impactAt(this.index, minutes);
  }

  dispose() {
    this.pass?.dispose();
    this.arrival?.texture.dispose();
  }
}
