import type { Beat } from "../script";

export type Focus = "town" | "house" | "roseland" | "zone" | "rescue";
export type HouseState = "hidden" | "lit" | "calling" | "out";

// What the night map shows on a beat. `zoom` is the camera's, centred on `focus`: the story house,
// Roseland's house, the evacuation zone or the whole town; `offsetX` pans the camera so that place sits that far from the middle, leaving room for a card.
// `fire` is how far the fire has run, as a share of the time it takes to reach the house.
export type Shot = {
  shown: boolean;
  zoom: number;
  focus: Focus;
  offsetX: number;
  fire: number;
  house: HouseState;
  dark: number;
  wave: boolean;
};

const TOWN: Shot = { shown: true, zoom: 1, focus: "town", offsetX: 0, fire: 0.12, house: "hidden", dark: 0.25, wave: false };
const OFF: Shot = { ...TOWN, shown: false };
// While the crowd is on screen the fire follows the crowd model's own clock (see MapOverlay), so a car is
// never drawn inside it. This is only where the camera's fire starts from on those beats.
const CROWD_FIRE = 0.27;

export const SHOTS: Record<Beat, Shot> = {
  title: TOWN,
  anthony: { ...TOWN, dark: 0.7 },
  family: { ...TOWN, zoom: 3.2, focus: "house", fire: 0.2, house: "lit", dark: 0 },
  night: { ...TOWN, zoom: 1.6, focus: "house", fire: 0.42, house: "lit", dark: 0 },
  calls: { ...TOWN, zoom: 2.6, focus: "house", offsetX: -360, fire: 0.78, house: "calling", dark: 0 },
  gone: { ...TOWN, zoom: 2.6, focus: "house", fire: 1, house: "out", dark: 0.88 },
  // The fire rewinds while the US map is up, so the house comes back dark and alone in a quiet town.
  everywhere: { ...OFF, zoom: 3.2, focus: "house", fire: 0, house: "out" },
  eighty: { ...OFF, zoom: 3.2, focus: "house", fire: 0, house: "out" },
  howSave: { ...TOWN, zoom: 3.2, focus: "house", offsetX: -380, fire: 0, house: "out", dark: 0.35 },
  stations: { ...OFF, zoom: 3.2, focus: "house", fire: 0, house: "out" },
  dispatch: OFF,
  built: OFF,
  tenThousand: { ...TOWN, fire: 0, dark: 0.1, wave: true },
  zone: { ...TOWN, zoom: 1.1, focus: "zone", offsetX: 180, fire: 0.15, dark: 0.15 },
  census: { ...TOWN, zoom: 1.1, focus: "zone", offsetX: 180, fire: 0.2, dark: 0.15 },
  roseland: { ...TOWN, zoom: 3, focus: "roseland", offsetX: -400, fire: 0.25, dark: 0.2 },
  testCall: { ...TOWN, zoom: 3, focus: "roseland", offsetX: -400, fire: 0.25, dark: 0.2 },
  ink: OFF,
  sonic: OFF,
  claude: OFF,
  protocol: OFF,
  request: { ...TOWN, zoom: 1.75, focus: "rescue", fire: 0.25, dark: 0.15 },
  alns: { ...TOWN, zoom: 1.75, focus: "rescue", fire: 0.25, dark: 0.15 },
  routes: { ...TOWN, zoom: 1.75, focus: "rescue", fire: 0.25, dark: 0.15 },
  crowd: { ...TOWN, zoom: 1.3, focus: "zone", fire: CROWD_FIRE, dark: 0.2 },
  jams: { ...TOWN, zoom: 1.3, focus: "zone", fire: CROWD_FIRE, dark: 0.2 },
  hub: OFF,
  stress: OFF,
  nights: OFF,
  today: OFF,
  ours: OFF,
  quote: OFF,
  // The close returns to the dark house from 1.5, then runs the fire back so that this time the call gets there first.
  told: { ...TOWN, zoom: 2.6, focus: "house", offsetX: -360, fire: 1, house: "out", dark: 0.78 },
  reached: { ...TOWN, zoom: 1.5, focus: "house", fire: 0.6, house: "calling", dark: 0.1 },
  everyone: { ...TOWN, zoom: 1.15, fire: 0.6, house: "lit", dark: 0.35 },
  saveLives: { ...TOWN, zoom: 1.15, fire: 0.6, house: "lit", dark: 0.8 },
  wordmark: { ...TOWN, zoom: 1.15, fire: 0.6, house: "lit", dark: 0.8 },
};
