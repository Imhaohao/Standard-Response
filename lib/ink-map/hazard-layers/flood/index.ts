import { PlaceholderLayer } from "../placeholder";
import type { HazardLayerFactory } from "../types";

// Stand-in until the flood renderer lands: hatching over the ground the scenario's fronts reach.
export const createFloodLayer: HazardLayerFactory = (context) => new PlaceholderLayer("flood", context, { tint: context.shared.uIndigo.value, angle: 0 });
