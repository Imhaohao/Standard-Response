import { v } from "convex/values";

// Hazards the pipeline runs for. The operator picks one before the warning; the voice agent's
// safety line, the interpreter's emergency rule and the scenario file follow it.
export const HAZARDS = ["wildfire", "earthquake", "flood", "hurricane"] as const;
export type Hazard = (typeof HAZARDS)[number];

export const hazard = v.union(...HAZARDS.map((kind) => v.literal(kind)));

export const DEFAULT_HAZARD: Hazard = "wildfire";

export const hazardOf = (value: string | undefined): Hazard =>
  (HAZARDS as readonly string[]).includes(value ?? "") ? (value as Hazard) : DEFAULT_HAZARD;

// The escalation raised when the resident says the hazard itself is at the home now.
// Wildfire keeps its original name so existing evals and badges stay valid.
export type HazardEscalation = "flames" | "hazard_at_home";

export const hazardEscalation = (kind: Hazard): HazardEscalation => (kind === "wildfire" ? "flames" : "hazard_at_home");

// The scenario file for each hazard under data/hazard. A missing file leaves the map layer off.
export const SCENARIO_FILES: Record<Hazard, string> = {
  wildfire: "scenario.geojson",
  earthquake: "scenario-earthquake.geojson",
  flood: "scenario-flood.geojson",
  hurricane: "scenario-hurricane.geojson",
};
