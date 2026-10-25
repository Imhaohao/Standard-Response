import { createWaterLayer } from "../water/layer";
import type { HazardLayerFactory } from "../types";

// A tsunami: before each crest the sea draws back and bares the bay floor, then a bore with a curling
// foam lip runs up the bay and over the waterfront, and drains away again, once for every wave.
export const createTsunamiLayer: HazardLayerFactory = createWaterLayer("tsunami");
