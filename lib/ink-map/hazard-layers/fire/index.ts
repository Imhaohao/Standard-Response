import * as THREE from "three";
import { FlameField } from "../../flames";
import { BLUR_FRAGMENT, FIRE_MASK_FRAGMENT } from "../../shaders";
import { arrivalIndex, arrivalTexture, ArrivalIndex, impactAt, NO_IMPACT } from "../arrival";
import type { FullscreenPass, HazardLayer, HazardLayerContext, HazardLayerFactory } from "../types";

// Flames stand on the town and the hills the camera can reach around it, not the whole field.
const FLAME_MARGIN_METERS = 2500;

// The wildfire: the fire zone and its edge are drawn by the composite itself (shaders.ts reads
// tFire and the uFire* uniforms this layer sets), the glow and embers by the renderer's present pass
// from the bloom this layer prepares, and the flames are this layer's own geometry.
// `burning` false shades the ground the hazard reaches without flames or embers (an earthquake).
class FireLayer implements HazardLayer {
  readonly kind = "wildfire" as const;
  readonly animates = true;
  private mask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private blurA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private bloom = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private maskPass: FullscreenPass;
  private blurPass: FullscreenPass;
  private flames: FlameField;
  private arrival: ReturnType<typeof arrivalTexture> | null = null;
  private index: ArrivalIndex | null = null;

  constructor(
    private context: HazardLayerContext,
    private burning: boolean,
  ) {
    const { shared, field, bounds, data } = context;
    this.maskPass = context.fullscreen(FIRE_MASK_FRAGMENT, shared);
    this.blurPass = context.fullscreen(BLUR_FRAGMENT, { tInput: { value: null }, uDirection: { value: new THREE.Vector2() } });
    const flameBounds = { x0: bounds.x0 - FLAME_MARGIN_METERS, y0: bounds.y0 - FLAME_MARGIN_METERS, x1: bounds.x1 + FLAME_MARGIN_METERS, y1: bounds.y1 + FLAME_MARGIN_METERS };
    this.flames = new FlameField(data, flameBounds, shared);
    shared.tFrontMask.value = this.mask.texture;
    shared.tBloom.value = this.bloom.texture;
    shared.uBurning.value = burning ? 1 : 0;
    this.flames.place(this.burningField(), shared.uFireNow.value);
    if (!field) return;
    this.arrival = arrivalTexture(field);
    shared.tFire.value = this.arrival.texture;
    shared.uFireRegion.value.copy(this.arrival.region);
    shared.uFireLast.value = this.arrival.last;
    shared.uFireOn.value = 1;
  }

  private burningField() {
    return this.burning ? this.context.field : null;
  }

  setMinutes(minutes: number) {
    this.flames.place(this.burningField(), minutes);
  }

  resize(width: number, height: number) {
    for (const target of [this.mask, this.blurA, this.bloom]) target.setSize(Math.ceil(width / 4), Math.ceil(height / 4));
  }

  // The crisp glow mask stays in `mask` for the flames; two blur rounds spread it into bloom.
  prepare() {
    const { three, shared } = this.context;
    if (shared.uFireOn.value < 0.5) return;
    three.setRenderTarget(this.mask);
    this.maskPass.draw();
    const texel = new THREE.Vector2(1 / this.mask.width, 1 / this.mask.height);
    const b = this.blurPass.material.uniforms;
    for (let pass = 0; pass < 2; pass++) {
      b.tInput.value = pass === 0 ? this.mask.texture : this.bloom.texture;
      b.uDirection.value.set(texel.x * (1 + pass), 0);
      three.setRenderTarget(this.blurA);
      this.blurPass.draw();
      b.tInput.value = this.blurA.texture;
      b.uDirection.value.set(0, texel.y * (1 + pass));
      three.setRenderTarget(this.bloom);
      this.blurPass.draw();
    }
  }

  // The flames test against the town's depth in their own shader, and against each other with the
  // canvas's depth buffer.
  drawScene({ camera }: { camera: THREE.Camera }) {
    if (this.flames.count === 0) return;
    this.context.three.render(this.flames.scene, camera);
  }

  impact(minutes: number) {
    if (!this.context.field) return NO_IMPACT;
    this.index ??= arrivalIndex(this.context.data, this.context.field);
    return impactAt(this.index, minutes);
  }

  dispose() {
    const { shared } = this.context;
    shared.uFireOn.value = 0;
    this.arrival?.texture.dispose();
    this.flames.dispose();
    this.maskPass.dispose();
    this.blurPass.dispose();
    for (const target of [this.mask, this.blurA, this.bloom]) target.dispose();
  }
}

export const createFireLayer: HazardLayerFactory = (context, { burning = true }) => new FireLayer(context, burning);
