import * as THREE from "three";
import { InkMapData, Point, terrainHeight } from "./data";
import { configureCamera, InkMapView, viewRegion } from "./camera";
import type { ForecastField } from "./danger";
import { NEVER_BURNS, type FireField } from "./fire-field";
import { HazardHost, type HazardRequest } from "./hazard-layers/host";
import type { HazardFrame, HazardImpact } from "./hazard-layers/types";
import { buildingGeometry, landuseTexture, LanduseTexture, roadGeometry, terrainChunks, TreeTile, treeTiles } from "./geometry";
import {
  COMPOSITE_FRAGMENT,
  DEPTH_FRAGMENT,
  DEPTH_VERTEX,
  FIRE_FRAGMENT,
  FULLSCREEN_VERTEX,
  GBUFFER_FRAGMENT,
  GBUFFER_VERTEX,
} from "./shaders";

// Palette in linear-ish sRGB floats. These mirror --paper, --ink, --signal, --ember and --map-indigo
// in globals.css. Indigo is the woodblock Prussian blue of water (flood, surge, tsunami), the one
// hue besides red; snow stays ink and paper.
function terrainExtent({ terrain }: InkMapData) {
  return new THREE.Vector4(terrain.x0, terrain.y0, terrain.x0 + (terrain.cols - 1) * terrain.cell, terrain.y0 + (terrain.rows - 1) * terrain.cell);
}

export const INK_PALETTE = {
  paper: [0.965, 0.953, 0.925],
  ink: [0.11, 0.1, 0.09],
  red: [0.86, 0.16, 0.12],
  ember: [1.0, 0.42, 0.12],
  indigo: [0.126, 0.263, 0.433],
} as const;

const FLIGHT_MS = 650;
const SUN = new THREE.Vector3(-0.68, 0.62, -0.39).normalize();

// level: how red the roof goes for a person who needs a ride. occupancy: whether the household
// under it has left (the roof clears) or is still home without a ride asked for (the roof goes dark).
export type Occupancy = "stillHome" | "left";
export type BuildingState = { level: number; pulse: boolean; occupancy?: Occupancy };
const OCCUPANCY_BYTE: Record<Occupancy, number> = { stillHome: 255, left: 128 };
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

// GPU memory is the machine's RAM on a Mac, and every full-size target costs width x height x bytes.
// The screen-size targets stay under this many pixels, so a retina display draws at a little under 2x
// rather than spending four times the memory, and the sun's shadow map is a fixed 2048 square.
const MAX_TARGET_PIXELS = 2_500_000;
const SHADOW_SIZE = 2048;
const SOFTWARE_SHADOW_SIZE = 1024;

// A browser drawing WebGL on the CPU (SwiftShader in headless Chrome, llvmpipe) holds every GPU buffer
// in ordinary memory and draws each pixel on the CPU, so it gets 1x pixels and a smaller shadow map.
function drawsOnCpu(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
}

function emptyTexture() {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

const TREE_FAR_METERS_PER_PIXEL = 0.6;

export class InkMapRenderer {
  readonly camera = new THREE.PerspectiveCamera();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private depthScene = new THREE.Scene();
  private gbuffer: THREE.WebGLRenderTarget;
  private shadow: THREE.WebGLRenderTarget;
  private shadowCamera = new THREE.OrthographicCamera();
  // The map without anything that moves, redrawn only when the view, the fire's minute or a home changes.
  private base: THREE.WebGLRenderTarget;
  private baseDirty = true;
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private gbufferUniforms: Record<string, THREE.IUniform>;
  private composite: ReturnType<typeof fullscreenPass>;
  private fire: ReturnType<typeof fullscreenPass>;
  private hazards: HazardHost;
  private blank = emptyTexture();
  private landuse: LanduseTexture;
  private buildingStates: THREE.DataTexture;
  private forecastTexture: THREE.DataTexture | null = null;
  private cssSize = { width: 1, height: 1 };
  private frame = 0;
  private running = false;
  private startedAt = performance.now();
  // Seconds a recorder pinned the animation clock to, so every capture of a minute looks the same.
  private frozenSeconds: number | null = null;
  private drawnWaiters: (() => void)[] = [];
  private disposables: { dispose: () => void }[] = [];
  private treeTiles: TreeTile[] = [];
  private treesUploaded = false;
  private onCpu: boolean;
  private pixelRatio: number;
  private pulsing = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private data: InkMapData,
    private view: InkMapView,
    private options: Options,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    this.onCpu = drawsOnCpu(this.renderer);
    this.pixelRatio = this.onCpu ? 1 : options.pixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const region = viewRegion(data, view);
    const fine = view.kind === "closeup";
    this.landuse = landuseTexture(data, region.buildings, fine ? 4 : 0.6);
    this.gbuffer = new THREE.WebGLRenderTarget(1, 1, { count: 3, depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType) });
    for (const texture of this.gbuffer.textures) {
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
    }
    const shadowSize = Math.min(this.renderer.capabilities.maxTextureSize, this.onCpu ? SOFTWARE_SHADOW_SIZE : SHADOW_SIZE);
    // The sun pass only writes depth, so its colour attachment is a single byte per texel.
    this.shadow = new THREE.WebGLRenderTarget(shadowSize, shadowSize, {
      format: THREE.RedFormat,
      depthTexture: new THREE.DepthTexture(shadowSize, shadowSize, THREE.FloatType),
    });
    this.base = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
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
    this.buildScene(region);
    this.composite = fullscreenPass(COMPOSITE_FRAGMENT, this.compositeUniforms());
    this.fire = fullscreenPass(FIRE_FRAGMENT, this.composite.material.uniforms);
    const [shade, normal, id] = this.gbuffer.textures;
    this.hazards = new HazardHost({
      three: this.renderer,
      data,
      view,
      bounds: region.buildings,
      gbuffer: { shade, normal, id, depth: this.gbuffer.depthTexture as THREE.DepthTexture },
      shared: this.composite.material.uniforms,
      invalidate: () => (this.baseDirty = true),
      blank: this.blank,
    });
    this.disposables.push(this.gbuffer, this.shadow, this.base, this.blank, this.landuse.texture, this.buildingStates, this.renderer);
  }

  private buildScene(region: ReturnType<typeof viewRegion>) {
    const material = rawMaterial(GBUFFER_VERTEX, GBUFFER_FRAGMENT, this.gbufferUniforms);
    const treeMaterial = rawMaterial(GBUFFER_VERTEX, GBUFFER_FRAGMENT, this.gbufferUniforms, { INSTANCED: "" });
    const depthMaterial = rawMaterial(DEPTH_VERTEX, DEPTH_FRAGMENT, {});
    const treeDepthMaterial = rawMaterial(DEPTH_VERTEX, DEPTH_FRAGMENT, {}, { INSTANCED: "" });
    const terrainRegion = region.terrain ?? { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
    const geometries = [
      ...terrainChunks(this.data, terrainRegion),
      buildingGeometry(this.data, region.buildings),
      roadGeometry(this.data, region.buildings, this.options.detailRoads ? 7 : 5),
    ];
    for (const geometry of geometries) {
      this.scene.add(new THREE.Mesh(geometry, material));
      this.depthScene.add(new THREE.Mesh(geometry, depthMaterial));
      this.disposables.push(geometry);
    }
    const trees = treeTiles(this.data, region.buildings, treeMaterial, treeDepthMaterial);
    this.treeTiles = trees.tiles;
    for (const tile of trees.tiles) {
      this.scene.add(tile.near, tile.far);
      this.disposables.push(tile.near.geometry, tile.far.geometry);
    }
    this.depthScene.add(trees.shadows);
    this.disposables.push(trees.shadows.geometry, material, treeMaterial, depthMaterial, treeDepthMaterial);
  }

  private compositeUniforms(): Record<string, THREE.IUniform> {
    const [pr, pg, pb] = INK_PALETTE.paper;
    return {
      tShade: { value: this.gbuffer.textures[0] },
      tNormal: { value: this.gbuffer.textures[1] },
      tId: { value: this.gbuffer.textures[2] },
      tDepth: { value: this.gbuffer.depthTexture },
      tBase: { value: this.base.texture },
      tFrontMask: { value: this.blank },
      tBloom: { value: this.blank },
      tFire: { value: this.blank },
      tBuildingState: { value: this.buildingStates },
      uInvProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPixelRatio: { value: this.pixelRatio },
      uBaseElevation: { value: this.data.terrain.base },
      uPaper: { value: new THREE.Vector3(pr, pg, pb) },
      uInk: { value: new THREE.Vector3(...INK_PALETTE.ink) },
      uCharcoal: { value: new THREE.Vector3(...INK_PALETTE.ink) },
      uRed: { value: new THREE.Vector3(...INK_PALETTE.red) },
      uEmber: { value: new THREE.Vector3(...INK_PALETTE.ember) },
      uIndigo: { value: new THREE.Vector3(...INK_PALETTE.indigo) },
      uFireRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFireNow: { value: 0 },
      uFireOn: { value: 0 },
      uNextFrontOn: { value: 1 },
      uFireLast: { value: 0 },
      uTime: { value: 0 },
      uPulse: { value: 1 },
      uDebug: { value: 0 },
      uInkStrength: { value: this.view.kind === "overview" ? 0.58 : 0.72 },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uViewMpp: { value: 1 },
      uPatternScale: { value: 1 },
      uPatternBlend: { value: 0 },
      tForecast: { value: emptyTexture() },
      uForecastRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
      uForecastOn: { value: 0 },
      uForecastAhead: { value: 60 },
      uExtent: { value: new THREE.Vector4(this.data.extent.x0, this.data.extent.y0, this.data.extent.x1, this.data.extent.y1) },
      uTerrainExtent: { value: terrainExtent(this.data) },
      uBurning: { value: 1 },
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
    const fits = Math.sqrt(MAX_TARGET_PIXELS / (this.cssSize.width * this.cssSize.height));
    this.pixelRatio = Math.min(this.onCpu ? 1 : this.options.pixelRatio, fits);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.cssSize.width, this.cssSize.height, false);
    this.composite.material.uniforms.uPixelRatio.value = this.pixelRatio;
    const pr = this.pixelRatio;
    const w = Math.round(this.cssSize.width * pr);
    const h = Math.round(this.cssSize.height * pr);
    this.gbuffer.setSize(w, h);
    this.base.setSize(w, h);
    this.hazards.resize(w, h);
    this.baseDirty = true;
    configureCamera(this.camera, this.data, this.view, this.cssSize.width / this.cssSize.height);
    this.home = { position: this.camera.position.clone(), target: this.lookTarget() };
    this.composite.material.uniforms.uResolution.value.set(w, h);
    this.applyNavigation();
    this.renderStatic();
    this.renderFrame();
  }

  // ---- Moving the view: drag to pan, wheel to zoom toward the cursor ----

  private home = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  private nav = { pan: new THREE.Vector3(), zoom: 1 };
  private viewListeners = new Set<() => void>();

  private lookTarget() {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const t = (this.terrainLevel() - this.camera.position.y) / direction.y;
    return this.camera.position.clone().addScaledVector(direction, t);
  }

  private terrainLevel() {
    const centre = this.camera.position;
    return terrainHeight(this.data.terrain, centre.x, -centre.z);
  }

  private applyNavigation() {
    const offset = this.home.position.clone().sub(this.home.target).divideScalar(this.nav.zoom);
    const target = this.home.target.clone().add(this.nav.pan);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    const u = this.composite.material.uniforms;
    u.uInvProjection.value.copy(this.camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(this.camera.matrixWorld);
    this.placeTone(this.camera.position.distanceTo(target));
  }

  // The tone grid's scale for the shader: metres per device pixel at the centre of the view, and
  // the power-of-two grid nearest it (see placePattern in shaders.ts).
  private placeTone(centreDepth: number) {
    const u = this.composite.material.uniforms;
    const devicePixels = this.cssSize.height * this.pixelRatio;
    const metersPerPixel = (centreDepth * 2 * Math.tan((this.camera.fov * Math.PI) / 360)) / devicePixels;
    const octave = Math.log2(metersPerPixel);
    const step = Math.floor(octave);
    u.uViewMpp.value = metersPerPixel;
    // A tree a few pixels across looks the same as a plain icosahedron and costs a quarter as much.
    const far = metersPerPixel > TREE_FAR_METERS_PER_PIXEL;
    for (const tile of this.treeTiles) {
      tile.near.visible = !far;
      tile.far.visible = far;
    }
    u.uPatternScale.value = 2 ** -step;
    u.uPatternBlend.value = THREE.MathUtils.smoothstep(octave - step, 0.4, 0.6);
    u.uCamRight.value.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    u.uCamUp.value.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
  }

  private lastViewDraw = 0;

  private redrawView() {
    this.lastViewDraw = performance.now();
    this.applyNavigation();
    this.renderer.setRenderTarget(this.gbuffer);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.baseDirty = true;
    this.renderFrame();
    for (const listener of this.viewListeners) listener();
  }

  onViewChange(listener: () => void) {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  get zoom() {
    return this.nav.zoom;
  }

  private clampPan() {
    const region = viewRegion(this.data, this.view).pan;
    const t = this.home.target;
    const x = THREE.MathUtils.clamp(t.x + this.nav.pan.x, region.x0, region.x1);
    const z = THREE.MathUtils.clamp(t.z + this.nav.pan.z, -region.y1, -region.y0);
    this.nav.pan.set(x - t.x, 0, z - t.z);
  }

  panBetween(fromX: number, fromY: number, toX: number, toY: number) {
    const from = this.pickGround(fromX, fromY);
    const to = this.pickGround(toX, toY);
    if (!from || !to) return;
    this.nav.pan.x -= to[0] - from[0];
    this.nav.pan.z += to[1] - from[1];
    this.clampPan();
    this.redrawView();
  }

  zoomAt(factor: number, cssX: number, cssY: number) {
    const before = this.pickGround(cssX, cssY);
    const limit = this.view.kind === "overview" ? 14 : 4;
    this.nav.zoom = THREE.MathUtils.clamp(this.nav.zoom * factor, 1, limit);
    this.applyNavigation();
    const after = this.pickGround(cssX, cssY);
    if (before && after) {
      this.nav.pan.x += before[0] - after[0];
      this.nav.pan.z -= before[1] - after[1];
    }
    this.clampPan();
    this.redrawView();
  }

  resetView() {
    cancelAnimationFrame(this.flight);
    this.nav = { pan: new THREE.Vector3(), zoom: 1 };
    this.redrawView();
  }

  private flight = 0;

  // Glides the view so a place sits in the middle of the map, zoomed in at least as far as asked.
  flyTo([x, y]: Point, zoom: number) {
    cancelAnimationFrame(this.flight);
    const limit = this.view.kind === "overview" ? 14 : 4;
    const from = { pan: this.nav.pan.clone(), zoom: this.nav.zoom };
    const to = {
      pan: new THREE.Vector3(x - this.home.target.x, 0, -y - this.home.target.z),
      zoom: THREE.MathUtils.clamp(Math.max(zoom, this.nav.zoom), 1, limit),
    };
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / FLIGHT_MS);
      const eased = 1 - (1 - t) ** 3;
      this.nav.pan.lerpVectors(from.pan, to.pan, eased);
      this.nav.zoom = from.zoom * (to.zoom / from.zoom) ** eased;
      this.clampPan();
      this.redrawView();
      if (t < 1) this.flight = requestAnimationFrame(step);
    };
    this.flight = requestAnimationFrame(step);
  }

  // Every tree tile, near and far, drawn once with culling off so its buffers reach the GPU now.
  // Otherwise the detailed tiles upload the moment a zoom first crosses into them, and the zoom
  // stalls halfway.
  private uploadTrees() {
    const meshes = this.treeTiles.flatMap((tile) => [tile.near, tile.far]);
    const shown = meshes.map((mesh) => mesh.visible);
    for (const mesh of meshes) [mesh.visible, mesh.frustumCulled] = [true, false];
    this.renderer.setRenderTarget(this.gbuffer);
    this.renderer.render(this.scene, this.camera);
    meshes.forEach((mesh, i) => ([mesh.visible, mesh.frustumCulled] = [shown[i], true]));
  }

  // A slower camera move that can zoom out as well as in, for the pitch deck. A null place glides
  // back to the town overview.
  glideTo(place: Point | null, zoom: number, ms: number) {
    cancelAnimationFrame(this.flight);
    const limit = this.view.kind === "overview" ? 14 : 4;
    const from = { pan: this.nav.pan.clone(), zoom: this.nav.zoom };
    const to = {
      pan: place ? new THREE.Vector3(place[0] - this.home.target.x, 0, -place[1] - this.home.target.z) : new THREE.Vector3(),
      zoom: THREE.MathUtils.clamp(zoom, 1, limit),
    };
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      this.nav.pan.lerpVectors(from.pan, to.pan, eased);
      this.nav.zoom = from.zoom * (to.zoom / from.zoom) ** eased;
      this.clampPan();
      this.redrawView();
      if (t < 1) this.flight = requestAnimationFrame(step);
    };
    this.flight = requestAnimationFrame(step);
  }

  private renderStatic() {
    this.fitShadowCamera();
    this.renderer.setRenderTarget(this.shadow);
    this.renderer.clear();
    this.renderer.render(this.depthScene, this.shadowCamera);
    if (!this.treesUploaded) {
      this.uploadTrees();
      this.treesUploaded = true;
    }
    this.renderer.setRenderTarget(this.gbuffer);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  private renderBase(frame: HazardFrame) {
    this.baseDirty = false;
    this.renderer.setRenderTarget(this.base);
    this.renderer.render(this.composite.scene, this.quadCamera);
    this.hazards.drawBase(frame);
  }

  private hazardFrame(seconds: number): HazardFrame {
    const { width, height } = this.base;
    return { minutes: this.composite.material.uniforms.uFireNow.value, seconds, camera: this.camera, viewport: { width, height } };
  }

  renderFrame() {
    const u = this.composite.material.uniforms;
    const seconds = this.frozenSeconds ?? (performance.now() - this.startedAt) / 1000;
    u.uTime.value = seconds;
    u.uPulse.value = 0.5 + 0.5 * Math.sin(seconds * 3.2);
    const frame = this.hazardFrame(seconds);
    if (this.baseDirty) this.renderBase(frame);
    this.hazards.prepare(frame);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.fire.scene, this.quadCamera);
    this.hazards.drawScreen(frame);
    this.renderHazardScene(frame);
    for (const resolve of this.drawnWaiters.splice(0)) resolve();
  }

  // A hazard's own geometry stands in the scene over the finished map. It tests against the town's
  // depth in its own shader, and against itself with the canvas's depth buffer.
  private renderHazardScene(frame: HazardFrame) {
    if (!this.hazards.drawsScene) return;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.hazards.drawScene(frame);
    this.renderer.autoClear = true;
  }

  // Resolves once the next frame has reached the canvas.
  nextFrame() {
    return new Promise<void>((resolve) => this.drawnWaiters.push(resolve));
  }

  // Pins the animation clock (seconds since the renderer started) for a frame-exact recording; null lets it run.
  freezeTime(seconds: number | null) {
    this.frozenSeconds = seconds;
    this.renderFrame();
  }

  // Animation runs only while something on the map moves: a hazard layer that animates (fire, water,
  // snow), a pulsing home, or a change waiting to be drawn.
  private moving() {
    return this.baseDirty || this.hazards.animates || this.pulsing;
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = 0;
    const tick = (time: number) => {
      if (!this.running) return;
      // A pan or zoom already drew this frame; drawing the fire again on top only costs time.
      if (time - last > 33 && time - this.lastViewDraw > 33 && this.moving()) {
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

  // `burning` false shades the area the hazard reaches without flames or embers (an earthquake).
  // The dashed line where the fire will be in half an hour. The pitch deck turns it off.
  setNextFront(shown: boolean) {
    this.composite.material.uniforms.uNextFrontOn.value = shown ? 1 : 0;
    this.renderFrame();
  }

  setFire(field: FireField | null, burning = true) {
    this.setHazard(field ? { kind: "wildfire", field, scenario: null, burning } : null);
  }

  // The hazard drawn over the town, by its layer in hazard-layers/registry.ts. Asking for the same
  // hazard again keeps the layer it has.
  setHazard(request: HazardRequest | null) {
    if (this.hazards.set(request)) this.baseDirty = true;
  }

  // What the hazard has reached by a minute: buildings, roads and dispatcher edges.
  hazardImpact(minutes: number): HazardImpact {
    return this.hazards.impact(minutes);
  }

  // The forecast bands on the ground (see forecastField in danger.ts), or none.
  setForecast(field: ForecastField | null, aheadMinutes: number) {
    const u = this.composite.material.uniforms;
    this.forecastTexture?.dispose();
    this.forecastTexture = null;
    this.baseDirty = true;
    u.uForecastOn.value = field ? 1 : 0;
    u.uForecastAhead.value = aheadMinutes;
    if (!field) return;
    const cells = field.width * field.height;
    const half = new Uint16Array(cells * 4).fill(THREE.DataUtils.toHalfFloat(NEVER_BURNS));
    for (let cell = 0; cell < cells; cell++) {
      for (let band = 0; band < 3; band++) half[cell * 4 + band] = THREE.DataUtils.toHalfFloat(field.minutes[cell * 3 + band]);
    }
    const texture = new THREE.DataTexture(half, field.width, field.height, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.forecastTexture = texture;
    u.tForecast.value = texture;
    u.uForecastRegion.value.set(field.region.x0, field.region.y0, field.region.x1, field.region.y1);
  }

  // Swaps the paper and ink, as the pitch deck does for its night map. The fire keeps its own colours.
  setPalette(paper: readonly [number, number, number], ink: readonly [number, number, number], charcoal = ink) {
    const u = this.composite.material.uniforms;
    u.uPaper.value.set(...paper);
    u.uInk.value.set(...ink);
    u.uCharcoal.value.set(...charcoal);
    this.baseDirty = true;
    this.renderFrame();
  }

  setDebug(mode: number) {
    this.composite.material.uniforms.uDebug.value = mode;
    this.baseDirty = true;
    this.renderFrame();
  }

  setFireMinutes(minutes: number) {
    const now = this.composite.material.uniforms.uFireNow;
    if (now.value === minutes) return;
    now.value = minutes;
    this.baseDirty = true;
    this.hazards.setMinutes(minutes);
  }

  setBuildingStates(states: Map<number, BuildingState>) {
    const pixels = this.buildingStates.image.data as Uint8Array;
    pixels.fill(0);
    for (const [id, state] of states) {
      pixels[id * 4] = Math.round(Math.min(1, state.level) * 255);
      pixels[id * 4 + 1] = state.pulse ? 255 : 0;
      pixels[id * 4 + 2] = state.occupancy ? OCCUPANCY_BYTE[state.occupancy] : 0;
    }
    this.buildingStates.needsUpdate = true;
    this.pulsing = [...states.values()].some((state) => state.pulse);
    this.baseDirty = true;
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

  // The drawing buffer isn't kept between frames, so draw one and read it in the same task.
  snapshot() {
    this.renderFrame();
    return this.canvas.toDataURL("image/png");
  }

  dispose() {
    this.stop();
    cancelAnimationFrame(this.flight);
    this.forecastTexture?.dispose();
    this.hazards.dispose();
    for (const item of this.disposables) item.dispose();
    // Without this the context, and every buffer in it, lives until garbage collection. A page that
    // remounts its map (navigation, hot reload) would stack a few hundred megabytes per mount.
    this.renderer.forceContextLoss();
  }
}
