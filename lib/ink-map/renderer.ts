import * as THREE from "three";
import { InkMapData, Point, terrainHeight } from "./data";
import { configureCamera, InkMapView, viewRegion } from "./camera";
import type { ForecastField } from "./danger";
import { NEVER_BURNS, type FireField } from "./fire-field";
import { FlameField } from "./flames";
import { buildingGeometry, landuseTexture, LanduseTexture, roadGeometry, terrainChunks, TreeTile, treeTiles } from "./geometry";
import {
  BLUR_FRAGMENT,
  COMPOSITE_FRAGMENT,
  DEPTH_FRAGMENT,
  DEPTH_VERTEX,
  FIRE_FRAGMENT,
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

function emptyTexture() {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

const TREE_FAR_METERS_PER_PIXEL = 0.6;
// Flames stand on the town and the hills the camera can reach around it, not the whole field.
const FLAME_MARGIN_METERS = 2500;

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
  private fireMask: THREE.WebGLRenderTarget;
  private blurA: THREE.WebGLRenderTarget;
  private bloom: THREE.WebGLRenderTarget;
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private gbufferUniforms: Record<string, THREE.IUniform>;
  private composite: ReturnType<typeof fullscreenPass>;
  private fire: ReturnType<typeof fullscreenPass>;
  private flames: FlameField;
  private fireField: FireField | null = null;
  private mask: ReturnType<typeof fullscreenPass>;
  private blur: ReturnType<typeof fullscreenPass>;
  private landuse: LanduseTexture;
  private buildingStates: THREE.DataTexture;
  private fireTexture: THREE.DataTexture | null = null;
  private forecastTexture: THREE.DataTexture | null = null;
  private cssSize = { width: 1, height: 1 };
  private frame = 0;
  private running = false;
  private startedAt = performance.now();
  private disposables: { dispose: () => void }[] = [];
  private treeTiles: TreeTile[] = [];

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
    this.base = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.fireMask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.blurA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.bloom = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
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
    this.mask = fullscreenPass(FIRE_MASK_FRAGMENT, this.composite.material.uniforms);
    this.fire = fullscreenPass(FIRE_FRAGMENT, this.composite.material.uniforms);
    const b = region.buildings;
    const flameBounds = { x0: b.x0 - FLAME_MARGIN_METERS, y0: b.y0 - FLAME_MARGIN_METERS, x1: b.x1 + FLAME_MARGIN_METERS, y1: b.y1 + FLAME_MARGIN_METERS };
    this.flames = new FlameField(data, flameBounds, this.composite.material.uniforms);
    this.blur = fullscreenPass(BLUR_FRAGMENT, { tInput: { value: null }, uDirection: { value: new THREE.Vector2() } });
    this.disposables.push(this.gbuffer, this.shadow, this.base, this.fireMask, this.blurA, this.bloom, this.landuse.texture, this.buildingStates, this.renderer);
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
      tFrontMask: { value: this.fireMask.texture },
      tBloom: { value: this.bloom.texture },
      tFire: { value: emptyTexture() },
      tBuildingState: { value: this.buildingStates },
      uInvProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPixelRatio: { value: this.options.pixelRatio },
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
    this.renderer.setSize(this.cssSize.width, this.cssSize.height, false);
    const pr = this.options.pixelRatio;
    const w = Math.round(this.cssSize.width * pr);
    const h = Math.round(this.cssSize.height * pr);
    this.gbuffer.setSize(w, h);
    this.base.setSize(w, h);
    for (const target of [this.fireMask, this.blurA, this.bloom]) target.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
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
    const devicePixels = this.cssSize.height * this.options.pixelRatio;
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
    const region = viewRegion(this.data, this.view).buildings;
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

  // The crisp glow mask stays in fireMask for the flames; two blur rounds spread it into bloom.
  private renderBloom() {
    const u = this.composite.material.uniforms;
    if (u.uFireOn.value < 0.5) return;
    this.renderer.setRenderTarget(this.fireMask);
    this.renderer.render(this.mask.scene, this.quadCamera);
    const texel = new THREE.Vector2(1 / this.fireMask.width, 1 / this.fireMask.height);
    const b = this.blur.material.uniforms;
    for (let pass = 0; pass < 2; pass++) {
      b.tInput.value = pass === 0 ? this.fireMask.texture : this.bloom.texture;
      b.uDirection.value.set(texel.x * (1 + pass), 0);
      this.renderer.setRenderTarget(this.blurA);
      this.renderer.render(this.blur.scene, this.quadCamera);
      b.tInput.value = this.blurA.texture;
      b.uDirection.value.set(0, texel.y * (1 + pass));
      this.renderer.setRenderTarget(this.bloom);
      this.renderer.render(this.blur.scene, this.quadCamera);
    }
  }

  private renderBase() {
    this.baseDirty = false;
    this.renderer.setRenderTarget(this.base);
    this.renderer.render(this.composite.scene, this.quadCamera);
  }

  renderFrame() {
    const u = this.composite.material.uniforms;
    const seconds = (performance.now() - this.startedAt) / 1000;
    u.uTime.value = seconds;
    u.uPulse.value = 0.5 + 0.5 * Math.sin(seconds * 3.2);
    if (this.baseDirty) this.renderBase();
    this.renderBloom();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.fire.scene, this.quadCamera);
    this.renderFlames();
  }

  // The flames stand in the scene over the finished map. They test against the town's depth in
  // their own shader, and against each other with the canvas's depth buffer.
  private renderFlames() {
    if (this.flames.count === 0) return;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.flames.scene, this.camera);
    this.renderer.autoClear = true;
  }

  // Animation runs only while something on the map moves: fire, or a pulsing home.
  start() {
    if (this.running) return;
    this.running = true;
    let last = 0;
    const tick = (time: number) => {
      if (!this.running) return;
      // A pan or zoom already drew this frame; drawing the fire again on top only costs time.
      if (time - last > 33 && time - this.lastViewDraw > 33) {
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
  setFire(field: FireField | null, burning = true) {
    const u = this.composite.material.uniforms;
    this.fireTexture?.dispose();
    this.fireTexture = null;
    this.baseDirty = true;
    this.fireField = burning ? field : null;
    u.uBurning.value = burning ? 1 : 0;
    this.flames.place(this.fireField, u.uFireNow.value);
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
    this.baseDirty = true;
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
    this.flames.place(this.fireField, minutes);
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

  snapshot() {
    return this.canvas.toDataURL("image/png");
  }

  dispose() {
    this.stop();
    cancelAnimationFrame(this.flight);
    this.fireTexture?.dispose();
    this.forecastTexture?.dispose();
    this.flames.dispose();
    for (const item of this.disposables) item.dispose();
  }
}
