// Greenshields' speed-density line, v = v_free (1 - k / k_jam), as the crowd model drives by it.
// Dependency-free so the dispatcher's traffic-aware drive times (convex/traffic.ts) read the same law.

// A stated assumption: at a standstill each car takes 7.5 m of one lane. The dynamics use the same spacing.
export const JAM_SPACING_METERS = 7.5;
// The slowest a crowded street gets, as a share of its free speed. The dynamics use the same floor.
export const MIN_SPEED_SHARE = 0.05;
