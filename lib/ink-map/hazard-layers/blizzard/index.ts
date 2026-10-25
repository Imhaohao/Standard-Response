import * as THREE from "three";
import { BLUR_FRAGMENT } from "../../shaders";
import { PlaceholderLayer } from "../placeholder";
import type { FullscreenPass, HazardFrame, HazardImpact, HazardLayer, HazardLayerContext, HazardLayerFactory } from "../types";
import { barrierCards } from "./barrier-cards";
import { flakeMesh, MID_FLAKES, NEAR_FLAKES } from "./flakes";
import { footprintMask, type Region } from "./footprints";
import { geometryBytes, GpuBudget } from "./gpu-budget";
import { ATMOSPHERE_FRAGMENT, GLOW_MASK_FRAGMENT, SNOW_COVER_FRAGMENT } from "./glsl";
import { windowLights } from "./lights";
import { buildNetwork, closureBarriers, closureRules, closureStateKey, impactAt, roadWindows, type Network } from "./roads";
import { keepTargetAlpha, streetMaterial, streetRibbons } from "./streets";
import { blizzardWeather, type BlizzardWeather } from "./weather";

// The Buffalo blizzard on the ink map. Snow lies on the town as paper with thin ink edges, drifts
// against the walls that face the wind and buries the streets as they close; barriers stand across
// the closed ones, and ploughed streets come back as dark ruts. All of that is drawn into the cached
// map once per minute. Every frame the town dims toward night, fades toward paper as visibility
// falls, glows red where someone needs help, and the snow falls over it in layers: a grain screen far
// off, wind streaks, and big ink-ringed flakes up close. After dark the homes show warm windows.

// Snow, streets and drifts are worked out over the town and this much around it.
const TOWN_MARGIN_METERS = 600;
const GLOW_SCALE = 4;
// The fall's slant: how far sideways per unit of fall for each metre per second of crosswind.
const SLANT_PER_MPS = 1 / 4.5;
const MOST_SLANT = 2.6;
const LONGEST_FRAME_SECONDS = 0.1;
// The renderer keeps its screen targets under 2.5 million pixels (MAX_TARGET_PIXELS in renderer.ts).
const MOST_SCREEN_PIXELS = 2_500_000;
const HALF_FLOAT_RGBA_BYTES = 8;

const intersect = (a: Region, b: Region): Region => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const grow = (box: Region, by: number): Region => ({ x0: box.x0 - by, y0: box.y0 - by, x1: box.x1 + by, y1: box.y1 + by });
const within = (region: Region, [x, y]: [number, number]) => x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;

function maskTexture(context: HazardLayerContext, region: Region) {
  const mask = footprintMask(context.data.buildings, region);
  const texture = new THREE.DataTexture(mask.cells, mask.width, mask.height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.unpackAlignment = 1;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const extent = new THREE.Vector4(region.x0, region.y0, region.x0 + mask.width * mask.cellMeters, region.y0 + mask.height * mask.cellMeters);
  return { texture, extent };
}

function storm(shared: Record<string, THREE.IUniform>) {
  return {
    uMinutes: { value: 0 },
    uDepth: { value: 0 },
    uWindToward: { value: new THREE.Vector2(0, 1) },
    uWindSpeed: { value: 0 },
    uWhiteout: { value: 0 },
    uSnowfall: { value: 0 },
    uDaylight: { value: 1 },
    uNight: { value: 0 },
    uPowerOut: { value: 0 },
    uSlant: { value: 0 },
    uGust: { value: 1 },
    uFallTravel: { value: new THREE.Vector2() },
    uStreakTravel: { value: 0 },
    uVeilTravel: { value: new THREE.Vector2() },
    uCenterDistance: { value: 1000 },
    uNear: { value: 1 },
    uFar: { value: 1000 },
    // Lamplight: the ember mixed well toward the paper, so it reads as a window, never as a red home.
    uLamp: { value: (shared.uEmber.value as THREE.Vector3).clone().lerp(shared.uPaper.value as THREE.Vector3, 0.55) },
    tGlow: { value: null as THREE.Texture | null },
  };
}

type Storm = ReturnType<typeof storm>;

class BlizzardLayer implements HazardLayer {
  readonly kind = "blizzard" as const;
  readonly animates = true;
  private storm: Storm;
  private weather: BlizzardWeather;
  private windows: ReturnType<typeof roadWindows>;
  private rules: ReturnType<typeof closureRules>;
  private network: Network | null = null;
  private impacts = new Map<string, HazardImpact>();
  private footprints: ReturnType<typeof maskTexture>;
  private snow: FullscreenPass;
  private glowMask: FullscreenPass;
  private blur: FullscreenPass;
  private atmosphere: FullscreenPass;
  private glowTargets = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  private glowDirty = true;
  private baseScene = new THREE.Scene();
  private frontScene = new THREE.Scene();
  private lights: THREE.Mesh;
  private flakes: ReturnType<typeof flakeMesh>[];
  private lastSeconds: number | null = null;
  readonly gpu: GpuBudget;

  constructor(private context: HazardLayerContext) {
    const { data, scenario, bounds, shared } = context;
    this.storm = storm(shared);
    this.weather = blizzardWeather(scenario, 0, data.origin);
    this.rules = closureRules(scenario, data);
    this.windows = roadWindows(data, this.rules);
    const town = intersect(bounds, grow(data.detail, TOWN_MARGIN_METERS));
    // Everything below is built in ordinary memory first; nothing reaches the GPU until the budget passes.
    this.footprints = maskTexture(context, town);
    this.buildBaseScene(town);
    this.lights = windowLights(data, bounds, { ...this.pick("tDepth", "uResolution", "uPixelRatio"), ...this.ownUniforms("uNear", "uFar", "uPowerOut", "uNight", "uLamp", "uWhiteout") });
    this.lights.name = "window lights";
    this.flakes = [MID_FLAKES, NEAR_FLAKES].map((layer) =>
      flakeMesh(layer, { ...this.pick("uResolution", "uTime", "uPaper", "uInk", "uPixelRatio"), ...this.ownUniforms("uSlant", "uGust"), uTravel: this.storm.uFallTravel }),
    );
    this.frontScene.add(this.lights, ...this.flakes.map((flake) => flake.mesh));
    this.flakes.forEach((flake, i) => (flake.mesh.renderOrder = i + 1));
    this.gpu = this.countGpuBytes();
    this.gpu.assertWithin();
    this.snow = this.snowPass();
    this.glowMask = context.fullscreen(GLOW_MASK_FRAGMENT, { tId: shared.tId, tBuildingState: shared.tBuildingState, uResolution: shared.uResolution });
    this.blur = context.fullscreen(BLUR_FRAGMENT, { tInput: { value: null }, uDirection: { value: new THREE.Vector2() } });
    this.storm.tGlow.value = this.glowTargets[2].texture;
    this.atmosphere = this.atmospherePass();
  }

  // The terrain heights are the host's, but this layer is what makes it build them.
  private countGpuBytes() {
    const { terrain } = this.context.data;
    const budget = new GpuBudget()
      .add("footprint mask", this.footprints.texture.image.data?.byteLength ?? 0)
      .add("terrain heights", terrain.cols * terrain.rows * 4)
      .add("red glow", this.glowTargets.length * Math.ceil(MOST_SCREEN_PIXELS / GLOW_SCALE ** 2) * HALF_FLOAT_RGBA_BYTES);
    for (const mesh of [...this.baseScene.children, ...this.frontScene.children]) {
      if (mesh instanceof THREE.Mesh) budget.add(mesh.name || "flakes", geometryBytes(mesh.geometry));
    }
    return budget;
  }

  // The renderer's shared uniforms, by reference, so palette, camera and pattern stay in step.
  private pick(...names: string[]) {
    return Object.fromEntries(names.filter((name) => name in this.context.shared).map((name) => [name, this.context.shared[name]]));
  }

  private ownUniforms(...names: (keyof Storm)[]): Record<string, THREE.IUniform> {
    return Object.fromEntries(names.map((name) => [name, this.storm[name]]));
  }

  private snowPass() {
    const { terrain } = this.context;
    const uniforms = {
      ...this.pick("tDepth", "tShade", "tId", "tNormal", "tBuildingState", "uInvProjection", "uCameraWorld", "uBaseElevation", "uResolution", "uPaper", "uInk"),
      ...this.pick("uInkStrength", "uViewMpp", "uPatternScale", "uPatternBlend", "uPixelRatio", "uCamRight", "uCamUp"),
      ...this.ownUniforms("uDepth", "uWindToward", "uWindSpeed"),
      tTerrain: { value: terrain.texture },
      uTerrainRegion: { value: terrain.region },
      tFootprints: { value: this.footprints.texture },
      uFootprintRegion: { value: this.footprints.extent },
    };
    const pass = this.context.fullscreen(SNOW_COVER_FRAGMENT, uniforms, { blend: true });
    keepTargetAlpha(pass.material);
    return pass;
  }

  private atmospherePass() {
    return this.context.fullscreen(ATMOSPHERE_FRAGMENT, {
      ...this.pick("tBase", "tDepth", "tId", "tBuildingState", "uInvProjection", "uResolution", "uPixelRatio", "uTime", "uPaper", "uInk", "uRed", "uEmber", "uPulse"),
      ...this.ownUniforms("uWhiteout", "uSnowfall", "uDaylight", "uWindSpeed", "uSlant", "uCenterDistance", "uFallTravel", "uStreakTravel", "uVeilTravel", "tGlow"),
    });
  }

  private buildBaseScene(town: Region) {
    const { data } = this.context;
    const baseUniforms = { ...this.pick("tDepth", "uPaper", "uInk", "uInkStrength", "uResolution", "uPixelRatio"), ...this.ownUniforms("uNear", "uFar", "uMinutes", "uDepth") };
    const streets = new THREE.Mesh(streetRibbons(data, this.windows, town), streetMaterial(baseUniforms));
    const barriers = barrierCards(data, closureBarriers(data, this.windows).filter((barrier) => within(town, barrier.at)), baseUniforms);
    streets.frustumCulled = false;
    streets.name = "street ribbons";
    barriers.name = "barriers";
    barriers.renderOrder = 1;
    this.baseScene.add(streets, barriers);
  }

  setMinutes(minutes: number) {
    const weather = blizzardWeather(this.context.scenario, minutes, this.context.data.origin);
    this.weather = weather;
    const s = this.storm;
    s.uMinutes.value = minutes;
    s.uDepth.value = weather.depthMeters;
    s.uWindToward.value.set(...weather.windToward);
    s.uWindSpeed.value = weather.windMetersPerSecond;
    s.uWhiteout.value = weather.whiteout;
    s.uSnowfall.value = weather.snowfall;
    s.uDaylight.value = weather.daylight;
    s.uNight.value = 1 - weather.daylight;
    s.uPowerOut.value = weather.powerOutShare;
    for (const flake of this.flakes) flake.show(weather.snowfall);
    this.lights.visible = weather.daylight < 0.98;
  }

  private placeCamera({ camera, viewport }: HazardFrame) {
    const s = this.storm;
    s.uNear.value = camera.near;
    s.uFar.value = camera.far;
    const mpp = this.context.shared.uViewMpp.value as number;
    s.uCenterDistance.value = (mpp * viewport.height) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }

  // How the wind crosses the screen: its sideways part slants the fall, and the whole of it carries
  // the veils of blown snow (away from the camera is up the screen).
  private screenWind() {
    const { shared } = this.context;
    const [east, north] = this.weather.windToward;
    const wind = new THREE.Vector3(east, 0, -north);
    const right = wind.dot(shared.uCamRight.value as THREE.Vector3);
    const up = wind.dot(shared.uCamUp.value as THREE.Vector3);
    const slant = THREE.MathUtils.clamp(right * this.weather.windMetersPerSecond * SLANT_PER_MPS, -MOST_SLANT, MOST_SLANT);
    return { slant, across: new THREE.Vector2(right, up).normalize() };
  }

  // The snow's travel, summed frame by frame, so a change in the wind turns the fall smoothly.
  private advance(seconds: number) {
    const dt = this.lastSeconds === null ? 0 : THREE.MathUtils.clamp(seconds - this.lastSeconds, 0, LONGEST_FRAME_SECONDS);
    this.lastSeconds = seconds;
    const s = this.storm;
    const { slant, across } = this.screenWind();
    const { windMetersPerSecond: wind, gustMetersPerSecond: gust } = this.weather;
    const gustiness = wind > 0 ? Math.max(0, gust - wind) / wind : 0;
    s.uSlant.value = slant;
    s.uGust.value = (0.8 + wind / 30) * (1 + gustiness * 0.6 * Math.sin(seconds * 0.9) * Math.sin(seconds * 0.37 + 1.3));
    const fall = new THREE.Vector2(slant, -1).normalize();
    s.uFallTravel.value.addScaledVector(fall, s.uGust.value * dt);
    s.uStreakTravel.value += s.uGust.value * dt;
    s.uVeilTravel.value.addScaledVector(across, (0.03 + 0.01 * wind) * dt);
  }

  drawBase(frame: HazardFrame) {
    const { three } = this.context;
    this.placeCamera(frame);
    this.snow.draw();
    const autoClear = three.autoClear;
    three.autoClear = false;
    three.render(this.baseScene, frame.camera);
    three.autoClear = autoClear;
    this.glowDirty = true;
  }

  // The red homes' glow, rebuilt only when the cached map was: a mask of the red roofs, blurred twice.
  prepare() {
    if (!this.glowDirty) return;
    this.glowDirty = false;
    const { three } = this.context;
    const [mask, across, glow] = this.glowTargets;
    three.setRenderTarget(mask);
    this.glowMask.draw();
    const texel = new THREE.Vector2(1 / mask.width, 1 / mask.height);
    const b = this.blur.material.uniforms;
    for (let pass = 0; pass < 2; pass++) {
      b.tInput.value = pass === 0 ? mask.texture : glow.texture;
      b.uDirection.value.set(texel.x * (1 + pass), 0);
      three.setRenderTarget(across);
      this.blur.draw();
      b.tInput.value = across.texture;
      b.uDirection.value.set(0, texel.y * (1 + pass));
      three.setRenderTarget(glow);
      this.blur.draw();
    }
  }

  drawScreen(frame: HazardFrame) {
    this.placeCamera(frame);
    this.advance(frame.seconds);
    this.atmosphere.draw();
  }

  drawScene({ camera }: HazardFrame) {
    const { three } = this.context;
    const autoClear = three.autoClear;
    three.autoClear = false;
    three.render(this.frontScene, camera);
    three.autoClear = autoClear;
  }

  resize(width: number, height: number) {
    for (const target of this.glowTargets) target.setSize(Math.ceil(width / GLOW_SCALE), Math.ceil(height / GLOW_SCALE));
    this.glowDirty = true;
  }

  impact(minutes: number) {
    const key = closureStateKey(this.rules, minutes);
    const known = this.impacts.get(key);
    if (known) return known;
    this.network ??= buildNetwork(this.context.data, this.windows);
    const impact = impactAt(this.context.data, this.windows, this.network, minutes);
    this.impacts.set(key, impact);
    return impact;
  }

  dispose() {
    for (const pass of [this.snow, this.glowMask, this.blur, this.atmosphere]) pass.dispose();
    for (const target of this.glowTargets) target.dispose();
    this.footprints.texture.dispose();
    for (const scene of [this.baseScene, this.frontScene]) {
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      });
    }
  }
}

// A blizzard that can't be built (a map without the data it needs) still shows where the storm is.
export const createBlizzardLayer: HazardLayerFactory = (context) => {
  try {
    return new BlizzardLayer(context);
  } catch (error) {
    console.error("Blizzard layer failed, drawing the stand-in", error);
    return new PlaceholderLayer("blizzard", context, { tint: context.shared.uInk.value, angle: Math.PI / 2 });
  }
};
