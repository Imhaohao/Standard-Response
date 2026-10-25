import type { HazardKind } from "../../cities";
import { createBlizzardLayer } from "./blizzard";
import { BlizzardPaper } from "./blizzard/paper";
import { createFireLayer } from "./fire";
import { FirePaper } from "./fire/paper";
import { createFloodLayer } from "./flood";
import { FloodPaper } from "./flood/paper";
import { createSurgeLayer } from "./surge";
import { SurgePaper } from "./surge/paper";
import { createTsunamiLayer } from "./tsunami";
import { TsunamiPaper } from "./tsunami/paper";
import type { HazardLayerFactory, PaperHazard } from "./types";

// One line per hazard: its 3D layer for the ink renderer, and its drawing for the flat map.
export const HAZARD_LAYERS: Record<HazardKind, { ink: HazardLayerFactory; paper: PaperHazard }> = {
  wildfire: { ink: createFireLayer, paper: FirePaper },
  flood: { ink: createFloodLayer, paper: FloodPaper },
  surge: { ink: createSurgeLayer, paper: SurgePaper },
  tsunami: { ink: createTsunamiLayer, paper: TsunamiPaper },
  blizzard: { ink: createBlizzardLayer, paper: BlizzardPaper },
};
