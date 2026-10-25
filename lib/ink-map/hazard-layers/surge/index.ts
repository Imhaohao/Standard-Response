import { createWaterLayer } from "../water/layer";
import type { HazardLayerFactory } from "../types";

// A storm surge: the sea rises with the storm tide, swell marches ashore in broken crests that throw
// spray, the water sloshes over the barrier island, and rain slants across the map on the wind.
export const createSurgeLayer: HazardLayerFactory = createWaterLayer("surge");
