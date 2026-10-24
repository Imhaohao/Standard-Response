import raw from "./scene.json";

export type XY = [number, number];
export type Household = { at: XY; kind: number };
export type Front = { minutes: number; rings: XY[][] };
export type Stop = { at: XY; lift: boolean; accepted: boolean };
export type Run = { label: string; at: XY; stops: Stop[]; path: XY[]; length: number };
export type Reroute = { label: string; from: XY; to: XY; before: XY[]; closed: XY[]; after: XY[] };

export const scene = raw as unknown as {
  size: { width: number; height: number };
  households: Household[];
  fronts: Front[];
  runs: Run[];
  reroute: Reroute;
};

export const routedRuns = scene.runs.filter((run) => run.path.length > 1);
