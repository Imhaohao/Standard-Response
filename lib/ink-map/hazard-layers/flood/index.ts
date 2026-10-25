import { createWaterLayer } from "../water/layer";
import type { HazardLayerFactory } from "../types";

// A levee breach: water pours through the gap in churning foam, runs down the low streets behind a
// hooked white edge carrying debris, rises house by house, and settles into a still sheet with slow rings.
export const createFloodLayer: HazardLayerFactory = createWaterLayer("flood");
