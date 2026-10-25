import * as THREE from "three";
import { InkMapData, Point, terrainHeight } from "./data";

// The camera never moves on its own. A view is fixed framing: the overview, or a close-up of one home.
export type InkMapView =
  | { kind: "overview"; fit: { x0: number; y0: number; x1: number; y1: number } }
  | { kind: "closeup"; center: Point; radius: number };

const OVERVIEW = { fov: 26, bearing: 16, pitch: 47 };
const CLOSEUP = { fov: 30, bearing: 20, pitch: 46 };

// Bearing is where the camera looks, clockwise from north. The camera sits opposite it.
function placeCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, bearing: number, pitch: number, distance: number) {
  const b = (bearing * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const horizontal = Math.cos(p) * distance;
  camera.position.set(target.x - Math.sin(b) * horizontal, target.y + Math.sin(p) * distance, target.z + Math.cos(b) * horizontal);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

function groundPoint(data: InkMapData, [x, y]: Point) {
  return new THREE.Vector3(x, terrainHeight(data.terrain, x, y), -y);
}

function projectedBounds(camera: THREE.PerspectiveCamera, corners: THREE.Vector3[]) {
  const ndc = corners.map((c) => c.clone().project(camera));
  return {
    minX: Math.min(...ndc.map((p) => p.x)),
    maxX: Math.max(...ndc.map((p) => p.x)),
    minY: Math.min(...ndc.map((p) => p.y)),
    maxY: Math.max(...ndc.map((p) => p.y)),
  };
}

// Finds the distance and target that make the fit rectangle fill the frame, centred.
function fitOverview(camera: THREE.PerspectiveCamera, data: InkMapData, fit: { x0: number; y0: number; x1: number; y1: number }) {
  const samples: Point[] = [];
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) samples.push([fit.x0 + ((fit.x1 - fit.x0) * i) / 4, fit.y0 + ((fit.y1 - fit.y0) * j) / 4]);
  }
  const corners = samples.map((p) => groundPoint(data, p));
  const target = groundPoint(data, [(fit.x0 + fit.x1) / 2, (fit.y0 + fit.y1) / 2]);
  let distance = Math.max(fit.x1 - fit.x0, fit.y1 - fit.y0) * 2;
  for (let pass = 0; pass < 6; pass++) {
    placeCamera(camera, target, OVERVIEW.bearing, OVERVIEW.pitch, distance);
    const b = projectedBounds(camera, corners);
    const spread = Math.max((b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2);
    distance *= spread / 0.94;
    placeCamera(camera, target, OVERVIEW.bearing, OVERVIEW.pitch, distance);
    const centred = projectedBounds(camera, corners);
    const shift = new THREE.Vector3((centred.minX + centred.maxX) / 2, (centred.minY + centred.maxY) / 2, 0.5).unproject(camera);
    const ray = shift.sub(camera.position).normalize();
    const t = (target.y - camera.position.y) / ray.y;
    target.copy(camera.position).addScaledVector(ray, t);
  }
  placeCamera(camera, target, OVERVIEW.bearing, OVERVIEW.pitch, distance);
}

export function configureCamera(camera: THREE.PerspectiveCamera, data: InkMapData, view: InkMapView, aspect: number) {
  camera.aspect = aspect;
  if (view.kind === "overview") {
    camera.fov = OVERVIEW.fov;
    camera.near = 40;
    camera.far = 40_000;
    camera.updateProjectionMatrix();
    fitOverview(camera, data, view.fit);
    return;
  }
  camera.fov = CLOSEUP.fov;
  camera.near = 5;
  camera.far = 6_000;
  camera.updateProjectionMatrix();
  const distance = (view.radius / Math.tan((CLOSEUP.fov * Math.PI) / 360)) * Math.max(1, 1 / aspect);
  placeCamera(camera, groundPoint(data, view.center), CLOSEUP.bearing, CLOSEUP.pitch, distance);
}

// What a view draws, and how far its camera may pan. The overview draws everything baked but keeps
// the camera over the town.
export function viewRegion(data: InkMapData, view: InkMapView) {
  if (view.kind === "overview") return { buildings: data.extent, terrain: null, pan: data.detail };
  const [x, y] = view.center;
  const r = view.radius * 3.2;
  const buildings = { x0: x - r, y0: y - r * 0.6, x1: x + r, y1: y + r * 1.8 };
  return { buildings, terrain: { x0: x - r * 2, y0: y - r, x1: x + r * 2, y1: y + r * 4 }, pan: buildings };
}
