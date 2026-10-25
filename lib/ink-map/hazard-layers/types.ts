import type * as THREE from "three";
import type { ReactNode } from "react";
import type { HazardKind } from "../../cities";
import type { InkMapView } from "../camera";
import type { InkMapData, Point } from "../data";
import type { FireField } from "../fire-field";
import type { Scenario } from "../scenario";

// The seam between the ink renderer and one kind of hazard. A layer lives in its own folder,
// hazard-layers/<kind>/, and is registered with one line in hazard-layers/registry.ts. The renderer
// never needs to know what a flood or a blizzard is.
//
// Each frame the renderer:
//   1. when the view, the minute or a home changed: draws the town into `base` (ink, tone, roofs),
//      then calls drawBase on the layer with `base` as the target (marks that only change with the minute);
//   2. calls prepare (offscreen passes of the layer's own, such as the fire's bloom);
//   3. draws base onto the canvas, then calls drawScreen with the canvas as the target (fullscreen
//      passes that animate: water ripples, falling snow, the fire's glow is drawn here by the renderer);
//   4. clears the canvas depth and calls drawScene (the layer's own geometry: flames, waves, particles).
//      Geometry tests against the town with tDepth in its own shader (see flames.ts), and against
//      itself with the canvas depth buffer.

// The G-buffer the town was drawn into, at device resolution. All Nearest-filtered.
//   shade.r   sun light 0..1 (cast shadows included)
//   shade.g   surface code / 255: 0 terrain, 1 wall, 2 roof, 3 road, 4 tree, 10 + k land use kind k - 1
//             (AREA_KIND in data.ts, so water areas are 10 + 2 + 1 = 13)
//   shade.b   world normal's up component * 0.5 + 0.5
//   normal    world normal * 0.5 + 0.5
//   id        object id in rgb bytes: 0 sky, 1 terrain, 2 road, 10 + k land use, 1000 + i building i, 100000+ trees
//   depth     hardware depth; worldPosition(uv, depth) in glsl.ts turns it back into the map
export type GBuffer = {
  shade: THREE.Texture;
  normal: THREE.Texture;
  id: THREE.Texture;
  depth: THREE.DepthTexture;
};

// The terrain as a float texture of absolute elevation in metres (the terrain's own datum), so a
// shader can ask for the ground under any map point: groundElevation(mapXY) in glsl.ts. A roof's
// pixel in the G-buffer is at roof height; this is the ground under it.
export type TerrainTexture = { texture: THREE.DataTexture; region: THREE.Vector4 };

export type FullscreenPass = {
  material: THREE.RawShaderMaterial;
  // Renders onto whatever target is current: `base` in drawBase, the canvas in drawScreen.
  draw: () => void;
  dispose: () => void;
};

export type HazardLayerContext = {
  three: THREE.WebGLRenderer;
  data: InkMapData;
  view: InkMapView;
  scenario: Scenario | null;
  // The hazard's arrival field: the minute it reaches each map point (fire-field.ts). Every hazard has one.
  field: FireField | null;
  // Ground the view can show, in map metres. Geometry outside it is never seen.
  bounds: { x0: number; y0: number; x1: number; y1: number };
  gbuffer: GBuffer;
  terrain: TerrainTexture;
  // The composite's uniforms, shared by reference. Read them in your own materials so palette, camera
  // and pattern scale stay in step: uPaper uInk uRed uEmber uIndigo, uInvProjection uCameraWorld,
  // uResolution uPixelRatio uTime uViewMpp uPatternScale uPatternBlend uCamRight uCamUp uBaseElevation,
  // tShade tNormal tId tDepth tBase.
  shared: Record<string, THREE.IUniform>;
  // A fullscreen pass with the renderer's vertex shader (out vUv). `blend` mixes its output over the
  // target by its alpha; without it the pass replaces the target.
  fullscreen: (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, options?: { blend?: boolean }) => FullscreenPass;
  // Asks for `base` to be redrawn on the next frame (after anything drawBase reads has changed).
  invalidate: () => void;
};

export type HazardFrame = {
  minutes: number;
  // Wall-clock seconds for animation. Frozen while a recorder holds the clock (renderer.freezeTime).
  seconds: number;
  camera: THREE.PerspectiveCamera;
  // Device pixels.
  viewport: { width: number; height: number };
};

// What the hazard has reached at a minute, so the map's roofs and road closures can follow it.
// Indices into data.buildings and data.roads; edge keys into data.graph (the dispatcher's road ids).
export type HazardImpact = { buildings: number[]; roads: number[]; edges: string[] };

export interface HazardLayer {
  readonly kind: HazardKind;
  // True when something moves even while the minute stands still (water, snow, flames); the renderer
  // then keeps drawing every frame instead of only when something changes.
  readonly animates: boolean;
  // The scenario clock moved.
  setMinutes(minutes: number): void;
  drawBase?(frame: HazardFrame): void;
  prepare?(frame: HazardFrame): void;
  drawScreen?(frame: HazardFrame): void;
  drawScene?(frame: HazardFrame): void;
  // The renderer's window changed size (device pixels): resize any targets of your own.
  resize?(width: number, height: number): void;
  impact(minutes: number): HazardImpact;
  dispose(): void;
}

export type HazardLayerOptions = { burning?: boolean };

export type HazardLayerFactory = (context: HazardLayerContext, options: HazardLayerOptions) => HazardLayer;

// The flat map's version of a hazard: SVG drawn over the paper map, in screen pixels.
// `project` maps map metres to the SVG's pixels; `trace(level)` is the outline of the ground the
// hazard reaches by minute `level`, as SVG path data, so a drawing rarely has to touch the field itself.
export type PaperHazardProps = {
  data: InkMapData;
  field: FireField;
  scenario: Scenario | null;
  minutes: number;
  burns: boolean;
  project: (point: Point) => { x: number; y: number; visible: boolean };
  trace: (level: number) => string;
};

export type PaperHazard = (props: PaperHazardProps) => ReactNode;
