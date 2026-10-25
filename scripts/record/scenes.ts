import type { Browser } from "playwright-core";
import type { Clip } from "./capture";
import type { World } from "./world";

export type SceneContext = { world: World; browser: Browser; root: string; outDir: string; appUrl: string; homes: number; fps: number };
export type SceneResult = { name: string; about: string; clips: Clip[] };
export type Scene = { name: string; about: string; run: (context: SceneContext) => Promise<SceneResult> };

export const SCENES: Scene[] = [];
