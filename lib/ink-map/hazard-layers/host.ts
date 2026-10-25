import * as THREE from "three";
import type { HazardKind } from "../../cities";
import type { InkMapView } from "../camera";
import type { InkMapData } from "../data";
import type { FireField } from "../fire-field";
import { FULLSCREEN_VERTEX } from "../shaders";
import type { Scenario } from "../scenario";
import { NO_IMPACT } from "./arrival";
import { HAZARD_LAYERS } from "./registry";
import type { FullscreenPass, GBuffer, HazardFrame, HazardLayer, HazardLayerContext, TerrainTexture } from "./types";

export type HazardRequest = { kind: HazardKind; field: FireField | null; scenario: Scenario | null; burning?: boolean };

type HostInputs = {
  three: THREE.WebGLRenderer;
  data: InkMapData;
  view: InkMapView;
  bounds: HazardLayerContext["bounds"];
  gbuffer: GBuffer;
  shared: Record<string, THREE.IUniform>;
  invalidate: () => void;
  blank: THREE.Texture;
};

const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export function fullscreen(three: THREE.WebGLRenderer, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, options: { blend?: boolean } = {}): FullscreenPass {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.RawShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    transparent: options.blend === true,
    blending: options.blend ? THREE.NormalBlending : THREE.NoBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return {
    material,
    // Never clears: a blended pass draws over what the target already holds.
    draw: () => {
      const autoClear = three.autoClear;
      three.autoClear = false;
      three.render(scene, quadCamera);
      three.autoClear = autoClear;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

// Absolute ground elevation as a 32-bit float texture, one texel per terrain sample.
function terrainTexture({ terrain }: InkMapData): TerrainTexture {
  const heights = Float32Array.from(terrain.heights, (h) => h + terrain.base);
  const texture = new THREE.DataTexture(heights, terrain.cols, terrain.rows, THREE.RedFormat, THREE.FloatType);
  texture.needsUpdate = true;
  const x1 = terrain.x0 + (terrain.cols - 1) * terrain.cell;
  const y1 = terrain.y0 + (terrain.rows - 1) * terrain.cell;
  return { texture, region: new THREE.Vector4(terrain.x0, terrain.y0, x1, y1) };
}

const sameRequest = (a: HazardRequest | null, b: HazardRequest | null) =>
  a?.kind === b?.kind && a?.field === b?.field && a?.scenario === b?.scenario && a?.burning === b?.burning;

// Owns the one hazard layer the renderer draws, and the GPU resources every layer shares.
export class HazardHost {
  private layer: HazardLayer | null = null;
  private request: HazardRequest | null = null;
  private terrain: TerrainTexture | null = null;
  private minutes = 0;
  private size = { width: 1, height: 1 };

  constructor(private inputs: HostInputs) {}

  get animates() {
    return this.layer?.animates ?? false;
  }

  get kind() {
    return this.layer?.kind ?? null;
  }

  // Swaps the layer when anything about the hazard changed; the same hazard asked for again is kept.
  set(request: HazardRequest | null) {
    if (sameRequest(request, this.request)) return false;
    this.request = request;
    this.layer?.dispose();
    this.layer = null;
    this.resetShared();
    if (request) this.layer = this.create(request);
    this.inputs.invalidate();
    return true;
  }

  private resetShared() {
    const { shared, blank } = this.inputs;
    shared.uFireOn.value = 0;
    shared.uBurning.value = 1;
    shared.tFire.value = blank;
    shared.tBloom.value = blank;
    shared.tFrontMask.value = blank;
  }

  private sharedTerrain = () => (this.terrain ??= terrainTexture(this.inputs.data));

  private create(request: HazardRequest) {
    const { three, data, view, bounds, gbuffer, shared, invalidate } = this.inputs;
    const terrain = this.sharedTerrain;
    const context: HazardLayerContext = {
      three,
      data,
      view,
      scenario: request.scenario,
      field: request.field,
      bounds,
      gbuffer,
      // Built the first time a layer asks: the fire never does.
      get terrain() {
        return terrain();
      },
      shared,
      fullscreen: (fragment, uniforms, options) => fullscreen(three, fragment, uniforms, options),
      invalidate,
    };
    const layer = HAZARD_LAYERS[request.kind].ink(context, { burning: request.burning });
    layer.resize?.(this.size.width, this.size.height);
    layer.setMinutes(this.minutes);
    return layer;
  }

  setMinutes(minutes: number) {
    this.minutes = minutes;
    this.layer?.setMinutes(minutes);
  }

  resize(width: number, height: number) {
    this.size = { width, height };
    this.layer?.resize?.(width, height);
  }

  drawBase(frame: HazardFrame) {
    this.layer?.drawBase?.(frame);
  }

  prepare(frame: HazardFrame) {
    this.layer?.prepare?.(frame);
  }

  drawScreen(frame: HazardFrame) {
    this.layer?.drawScreen?.(frame);
  }

  get drawsScene() {
    return Boolean(this.layer?.drawScene);
  }

  drawScene(frame: HazardFrame) {
    this.layer?.drawScene?.(frame);
  }

  impact(minutes: number) {
    return this.layer?.impact(minutes) ?? NO_IMPACT;
  }

  dispose() {
    this.layer?.dispose();
    this.layer = null;
    this.terrain?.texture.dispose();
  }
}
