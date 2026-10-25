import type { Load } from "./vehicleRun";

// What the re-planner sends to a dispatcher, and what comes back. dispatch/solver.py documents
// the same shape. All times are seconds from now; locations index into `matrix`.

export type ProblemVehicle = {
  id: string;
  location: number;
  // When the vehicle finishes its accepted run, and where (`location`). New stops come after it.
  availableAt: number;
  endBy: number;
  seats: number;
  wheelchairSpaces: number;
  stretcherSpaces: number;
};

export type ProblemRequest = {
  id: string;
  location: number;
  load: Load;
  boardingSeconds: number;
  deadline: number;
  weight: number;
  allowedVehicles: number[];
  openOfferVehicle: number | null;
  maxRideSeconds: number | null;
  // Their driver can no longer reach them, and they were told they're still at the top of the list:
  // the heuristic places them first, and the solvers price dropping them higher.
  reassigned?: boolean;
};

export type Problem = {
  policy: "alns" | "ortools" | "heuristic";
  locations: { lat: number; lng: number }[];
  matrix: (number | null)[][];
  vehicles: ProblemVehicle[];
  requests: ProblemRequest[];
  shelters: { id: string; location: number; capacity: number }[];
  timeLimitSeconds: number;
};

export type PlannedStop = { request: string; kind: "pickup" | "dropoff"; shelter: string | null; arrival: number };

export type Solution = {
  routes: { vehicle: string; stops: PlannedStop[] }[];
  dropped: string[];
  solver: "alns" | "ortools" | "heuristic";
  solveMs: number;
};

export function isSolution(value: unknown): value is Solution {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Solution>;
  return Array.isArray(candidate.routes) && Array.isArray(candidate.dropped) && typeof candidate.solveMs === "number";
}
