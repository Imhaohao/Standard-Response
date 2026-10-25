import { PlaceholderLayer } from "../placeholder";
import type { HazardLayerFactory } from "../types";

// Stand-in until the surge renderer lands: hatching over the ground the scenario's fronts reach.
export const createSurgeLayer: HazardLayerFactory = (context) => new PlaceholderLayer("surge", context, { tint: context.shared.uIndigo.value, angle: 0.35 });
