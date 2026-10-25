import { PlaceholderLayer } from "../placeholder";
import type { HazardLayerFactory } from "../types";

// Stand-in until the tsunami renderer lands: hatching over the ground the scenario's fronts reach.
export const createTsunamiLayer: HazardLayerFactory = (context) => new PlaceholderLayer("tsunami", context, { tint: context.shared.uIndigo.value, angle: -0.35 });
