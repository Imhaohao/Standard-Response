import * as THREE from "three";
import { InkMapData, Point, terrainHeight } from "./data";
import { configureCamera, InkMapView, viewRegion } from "./camera";
import type { FireField } from "./fire-field";
import { buildingGeometry, landuseTexture, LanduseTexture, roadGeometry, terrainGeometry, treeMesh } from "./geometry";
import {
  BLUR_FRAGMENT,
  COMPOSITE_FRAGMENT,
  DEPTH_FRAGMENT,
  DEPTH_VERTEX,
  FIRE_MASK_FRAGMENT,
  FULLSCREEN_VERTEX,
  GBUFFER_FRAGMENT,
  GBUFFER_VERTEX,
} from "./shaders";

// Palette in linear-ish sRGB floats. These mirror --paper, --ink, --signal and --ember in globals.css.
export const INK_PALETTE = {
  paper: [0.965, 0.953, 0.925],
  ink: [0.11, 0.1, 0.09],
  red: [0.86, 0.16, 0.12],
  ember: [1.0, 0.42, 0.12],
} as const;

const SUN = new THREE.Vector3(-0.68, 0.62, -0.39).normalize();

export type BuildingState = { level: number; pulse: boolean };
export type ScreenPoint = { x: number; y: number; visible: boolean };

type Options = { pixelRatio: number; detailRoads: boolean };

function rawMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string> = {}) {
  return new THREE.RawShaderMaterial({ vertexShader, fragmentShader, uniforms, defines, glslVersion: THREE.GLSL3, side: THREE.DoubleSide });
}

function fullscreenPass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.RawShaderMaterial({ vertexShader: FULLSCREEN_VERTEX, fragmentShader, uniforms, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, material };
}

function emptyTexture() {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export class InkMapRenderer {
  readonly camera = new THREE.PerspectiveCamera();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private depthScene = new THREE.Scene();
  private gbuffer: THREE.WebGLRenderTarget;
  private shadow: THREE.WebGLRenderTarget;
  private shadowCamera = new THREE.OrthographicCamera();
  private fireMask: THREE.WebGLRenderTarget;
  private blurA: THREE.WebGLRenderTarget;
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private gbufferUniforms: Record<string, THREE.IUniform>;
  private composite: ReturnType<typeof fullscreenPass>;
  private mask: ReturnType<typeof fullscreenPass>;
  private blur: ReturnType<typeof fullscreenPass>;
  private landuse: LanduseTexture;
  private buildingStates: THREE.DataTexture;
  private fireTexture: THREE.DataTexture | null = null;
  private cssSize = { width: 1, height: 1 };
  private frame = 0;
  private running = false;
  private startedAt = performance.now();
  private disposables: { dispose: () => void }[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private data: InkMapData,
    private view: InkMapView,
    private options: Options,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(options.pixelRatio);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const region = viewRegion(data, view);
    const fine = view.kind === "closeup";
    this.landuse = landuseTexture(data, region.buildings, fine ? 4 : 0.75);
    this.gbuffer = new THREE.WebGLRenderTarget(1, 1, { count: 3, depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType) });
    for (const texture of this.gbuffer.textures) {
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
    }
    const shadowSize = Math.min(this.renderer.capabilities.maxTextureSize, fine ? 4096 : 8192);
    this.shadow = new THREE.WebGLRenderTarget(shadowSize, shadowSize, { depthTexture: new THREE.DepthTexture(shadowSize, shadowSize, THREE.FloatType) });
    this.fireMask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.blurA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.buildingStates = new THREE.DataTexture(new Uint8Array(256 * Math.ceil(data.buildings.length / 256) * 4), 256, Math.ceil(data.buildings.length / 256), THREE.RGBAFormat);
    this.buildingStates.needsUpdate = true;

    this.gbufferUniforms = {
      uSun: { value: SUN },
      uShadowMap: { value: this.shadow.depthTexture },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowTexel: { value: 1 / shadowSize },
      uShadowBias: { value: 0.0005 },
      uLanduse: { value: this.landuse.texture },
      uLanduseRegion: { value: new THREE.Vector4(region.buildings.x0, region.buildings.y0, region.buildings.x1, region.buildings.y1) },
    };
    this.buildScene(region, fine);
    this.composite = fullscreenPass(COMPOSITE_FRAGMENT, this.compositeUniforms());
    this.mask = fullscreenPass(FIRE_MASK_FRAGMENT, this.composite.material.uniforms);
    this.blur = fullscreenPass(BLUR_FRAGMENT, { tInput: { value: null }, uDirection: { value: new THREE.Vector2() } });
    this.disposables.push(this.gbuffer, this.shadow, this.fireMask, this.blurA, this.landuse.texture, this.buildingStates, this.renderer);
  }

  private buildScene(region: ReturnType<typeof viewRegion>, fine: boolean) {
    const material = rawMaterial(GBUFFER_VERTEX, GBUFFER_FRAGMENT, this.gbufferUniforms);
    const treeMaterial = rawMaterial(GBUFFER_VERTEX, GBUFFER_FRAGMENT, this.gbufferUniforms, { INSTANCED: "" });
    const depthMaterial = rawMaterial(DEPTH_VERTEX, DEPTH_FRAGMENT, {});
    const treeDepthMaterial = rawMaterial(DEPTH_VERTEX, DEPTH_FRAGMENT, {}, { INSTANCED: "" });
    const terrainRegion = region.terrain ?? { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
    const geometries = [
      terrainGeometry(this.data, terrainRegion, fine ? 1 : 1),
      buildingGeometry(this.data, region.buildings),
      roadGeometry(this.data, region.buildings, this.options.detailRoads ? 7 : 5),
    ];
    for (const geometry of geometries) {
      this.scene.add(new THREE.Mesh(geometry, material));
      this.depthScene.add(new THREE.Mesh(geometry, depthMaterial));
      this.disposables.push(geometry);
    }
    const trees = treeMesh(this.data, region.buildings, treeMaterial);
    this.scene.add(trees);
    const treeShadows = new THREE.InstancedMesh(trees.geometry, treeDepthMaterial, trees.count);
    treeShadows.instanceMatrix = trees.instanceMatrix;
    treeShadows.frustumCulled = false;
    this.depthScene.add(treeShadows);
    this.disposables.push(trees.geometry, material, treeMaterial, depthMaterial, treeDepthMaterial);
  }

  private compositeUniforms(): Record<string, THREE.IUniform> {
    const [pr, pg, pb] = INK_PALETTE.paper;
    return {
      tShade: { value: this.gbuffer.textures[0] },
      tNormal: { value: this.gbuffer.textures[1] },
      tId: { value: this.gbuffer.textures[2] },
      tDepth: { value: this.gbuffer.depthTexture },
      tBloom: { value: this.fireMask.texture },
      tFire: { value: emptyTexture() },
      tBuildingState: { value: this.buildingStates },
      uInvProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPixelRatio: { value: this.options.pixelRatio },
      uTanHalfFov: { value: 0.25 },
      uBaseElevation: { value: this.data.terrain.base },
      uPaper: { value: new THREE.Vector3(pr, pg, pb) },
      uInk: { value: new THREE.Vector3(...INK_PALETTE.ink) },
      uRed: { value: new THREE.Vector3(...INK_PALETTE.red) },
      uEmber: { value: new THREE.Vector3(...INK_PALETTE.ember) },
      uFireRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFireNow: { value: 0 },
      uFireOn: { value: 0 },
      uFireLast: { value: 0 },
      uTime: { value: 0 },
      uPulse: { value: 1 },
      uDebug: { value: 0 },
    };
  }

  // Fits an orthographic sun camera around everything the view can show, for crisp cast shadows.
  private fitShadowCamera() {
    const region = viewRegion(this.data, this.view).buildings;
    const corners: THREE.Vector3[] = [];
    for (const x of [region.x0, region.x1]) {
      for (const y of [region.y0, region.y1]) {
        const h = terrainHeight(this.data.terrain, x, y);
        corners.push(new THREE.Vector3(x, h - 20, -y), new THREE.Vector3(x, h + 80, -y));
      }
    }
    const center = new THREE.Vector3((region.x0 + region.x1) / 2, 0, -(region.y0 + region.y1) / 2);
    const cam = this.shadowCamera;
    cam.position.copy(center).addScaledVector(SUN, 6000);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    const local = corners.map((c) => c.clone().applyMatrix4(cam.matrixWorldInverse));
    cam.left = Math.min(...local.map((p) => p.x));
    cam.right = Math.max(...local.map((p) => p.x));
    cam.bottom = Math.min(...local.map((p) => p.y));
    cam.top = Math.max(...local.map((p) => p.y));
    cam.near = Math.max(1, -Math.max(...local.map((p) => p.z)) - 500);
    cam.far = -Math.min(...local.map((p) => p.z)) + 500;
    cam.updateProjectionMatrix();
    this.gbufferUniforms.uShadowMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.gbufferUniforms.uShadowBias.value = 0.6 / (cam.far - cam.near);
  }

  resize(width: number, height: number) {
    this.cssSize = { width: Math.max(1, width), height: Math.max(1, height) };
    this.renderer.setSize(this.cssSize.width, this.cssSize.height, false);
    const pr = this.options.pixelRatio;
    const w = Math.round(this.cssSize.width * pr);
    const h = Math.round(this.cssSize.height * pr);
    this.gbuffer.setSize(w, h);
    this.fireMask.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    this.blurA.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    configureCamera(this.camera, this.data, this.view, this.cssSize.width / this.cssSize.height);
    const u = this.composite.material.uniforms;
    u.uResolution.value.set(w, h);
    u.uInvProjection.value.copy(this.camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(this.camera.matrixWorld);
    u.uTanHalfFov.value = Math.tan((this.camera.fov * Math.PI) / 360);
    this.renderStatic();
    this.renderFrame();
  }

  private renderStatic() {
    this.fitShadowCamera();
    this.renderer.setRenderTarget(this.shadow);
    this.renderer.clear();
    this.renderer.render(this.depthScene, this.shadowCamera);
    this.renderer.setRenderTarget(this.gbuffer);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  private renderBloom() {
    const u = this.composite.material.uniforms;
    if (u.uFireOn.value < 0.5) return;
    this.renderer.setRenderTarget(this.fireMask);
    this.renderer.render(this.mask.scene, this.quadCamera);
    const texel = new THREE.Vector2(1 / this.fireMask.width, 1 / this.fireMask.height);
    const b = this.blur.material.uniforms;
    for (let pass = 0; pass < 2; pass++) {
      b.tInput.value = this.fireMask.texture;
      b.uDirection.value.set(texel.x * (1 + pass), 0);
      this.renderer.setRenderTarget(this.blurA);
      this.renderer.render(this.blur.scene, this.quadCamera);
      b.tInput.value = this.blurA.texture;
      b.uDirection.value.set(0, texel.y * (1 + pass));
      this.renderer.setRenderTarget(this.fireMask);
      this.renderer.render(this.blur.scene, this.quadCamera);
    }
  }

  renderFrame() {
    const u = this.composite.material.uniforms;
    const seconds = (performance.now() - this.startedAt) / 1000;
    u.uTime.value = seconds;
    u.uPulse.value = 0.5 + 0.5 * Math.sin(seconds * 3.2);
    this.renderBloom();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.composite.scene, this.quadCamera);
  }

  // Animation runs only while something on the map moves: fire, or a pulsing home.
  start() {
    if (this.running) return;
    this.running = true;
    let last = 0;
    const tick = (time: number) => {
      if (!this.running) return;
      if (time - last > 33) {
        last = time;
        this.renderFrame();
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  setFire(field: FireField | null) {
    const u = this.composite.material.uniforms;
    this.fireTexture?.dispose();
    this.fireTexture = null;
    if (!field) {
      u.uFireOn.value = 0;
      return;
    }
    const half = new Uint16Array(field.minutes.length);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(field.minutes[i]);
    const texture = new THREE.DataTexture(half, field.width, field.height, THREE.RedFormat, THREE.HalfFloatType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.fireTexture = texture;
    u.tFire.value = texture;
    u.uFireRegion.value.set(field.region.x0, field.region.y0, field.region.x1, field.region.y1);
    u.uFireLast.value = field.fronts[field.fronts.length - 1].minutes;
    u.uFireOn.value = 1;
  }

  setDebug(mode: number) {
    this.composite.material.uniforms.uDebug.value = mode;
    this.renderFrame();
  }

  setFireMinutes(minutes: number) {
    this.composite.material.uniforms.uFireNow.value = minutes;
  }

  setBuildingStates(states: Map<number, BuildingState>) {
    const pixels = this.buildingStates.image.data as Uint8Array;
    pixels.fill(0);
    for (const [id, state] of states) {
      pixels[id * 4] = Math.round(Math.min(1, state.level) * 255);
      pixels[id * 4 + 1] = state.pulse ? 255 : 0;
    }
    this.buildingStates.needsUpdate = true;
  }

  // Map meters (and height above ground) to CSS pixels inside the canvas.
  project([x, y]: Point, lift = 0): ScreenPoint {
    const v = new THREE.Vector3(x, terrainHeight(this.data.terrain, x, y) + lift, -y).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.cssSize.width,
      y: ((1 - v.y) / 2) * this.cssSize.height,
      visible: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2,
    };
  }

  // Where a click lands on the ground, by marching the view ray over the height field.
  pickGround(cssX: number, cssY: number): Point | null {
    const ndc = new THREE.Vector3((cssX / this.cssSize.width) * 2 - 1, 1 - (cssY / this.cssSize.height) * 2, 0.5);
    const direction = ndc.unproject(this.camera).sub(this.camera.position).normalize();
    const origin = this.camera.position;
    const above = (t: number) => {
      const p = origin.clone().addScaledVector(direction, t);
      return p.y - terrainHeight(this.data.terrain, p.x, -p.z);
    };
    let previous = this.camera.near;
    for (let t = this.camera.near; t < this.camera.far; t += 12) {
      if (above(t) > 0) {
        previous = t;
        continue;
      }
      let lo = previous;
      let hi = t;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      const hit = origin.clone().addScaledVector(direction, hi);
      return [hit.x, -hit.z];
    }
    return null;
  }

  snapshot() {
    return this.canvas.toDataURL("image/png");
  }

  dispose() {
    this.stop();
    this.fireTexture?.dispose();
    for (const item of this.disposables) item.dispose();
  }
}
