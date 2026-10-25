import { PlaceholderLayer } from "../placeholder";
import type { HazardLayerFactory } from "../types";

// Stand-in until the blizzard renderer lands: hatching over the ground the scenario's fronts reach.
export const createBlizzardLayer: HazardLayerFactory = (context) => new PlaceholderLayer("blizzard", context, { tint: context.shared.uInk.value, angle: 1.5708 });
