import type { Beat } from "../script";

// What the map overlay draws on each beat after 2.7. Beats not listed draw nothing.
export type Layers = {
  zone: "off" | "draw" | "shown" | "faint";
  homes: "off" | "ring" | "census" | "dim";
  roseland: "off" | "lift" | "request";
  requests: boolean;
  rescuers: boolean;
  candidates: boolean;
  routes: "off" | "draw" | "faint";
  crowd: "off" | "flow" | "jams" | "faint";
  rescue: "off" | "house" | "everyone";
};

const NONE: Layers = {
  zone: "off",
  homes: "off",
  roseland: "off",
  requests: false,
  rescuers: false,
  candidates: false,
  routes: "off",
  crowd: "off",
  rescue: "off",
};

const CENSUS: Layers = { ...NONE, zone: "shown", homes: "census" };
const ROSELAND: Layers = { ...CENSUS, zone: "faint", homes: "dim", roseland: "lift" };
const REQUESTS: Layers = { ...ROSELAND, roseland: "request", requests: true };
// While the dispatcher plans, the only red dots are the requests in the plan, so every one on screen gets a route.
const PLANNING: Layers = { ...REQUESTS, homes: "off", rescuers: true };

export const LAYERS: Partial<Record<Beat, Layers>> = {
  zone: { ...NONE, zone: "draw", homes: "ring" },
  census: CENSUS,
  roseland: ROSELAND,
  testCall: ROSELAND,
  request: { ...REQUESTS, homes: "off" },
  alns: { ...PLANNING, candidates: true },
  routes: { ...PLANNING, routes: "draw" },
  crowd: { ...NONE, zone: "faint", routes: "faint", crowd: "flow" },
  jams: { ...NONE, zone: "faint", crowd: "jams" },
  reached: { ...NONE, rescue: "house" },
  everyone: { ...NONE, rescue: "everyone" },
  saveLives: { ...NONE, rescue: "everyone" },
  wordmark: { ...NONE, rescue: "everyone" },
};

export const layersFor = (beat: Beat) => LAYERS[beat] ?? NONE;

// The crowd night runs on from its warm-up only while the traffic is on screen.
export const CROWD_RUNS: readonly Beat[] = ["crowd", "jams"];
