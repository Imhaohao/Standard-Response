import { api } from "../convex/_generated/api";
import { DEFAULT_HAZARD, Hazard } from "../convex/hazards";
import { convex } from "./convex";

// The operator's hazard choice, kept current from Convex. Scripts that never call watchHazard
// (the red-team cases, unit runs) speak for the default hazard.
let current: Hazard = DEFAULT_HAZARD;

export const currentHazard = () => current;

export function watchHazard() {
  convex().onUpdate(api.control.get, {}, (control) => {
    if (control.hazard !== current) console.log(`[hazard] now ${control.hazard}`);
    current = control.hazard;
  });
}
