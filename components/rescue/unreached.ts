import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";
import { chanceAt, DangerZones, FORECAST_AHEAD_MINUTES } from "@/lib/ink-map/danger";
import { arrivalMinutesAt } from "@/lib/ink-map/fire-field";
import { Hazard } from "@/lib/ink-map/hazard";
import { Home, homeOccupancy } from "./marks";

// A home nobody has confirmed is out, with the fire on it or due within the hour. These are the
// people most likely to die, so the map paints them red and lists them first, whatever the reason
// nobody reached them.

export const ALERT_WINDOW_MINUTES = FORECAST_AHEAD_MINUTES;

export type FireThreat = { minutesToFire: number | null; inFire: boolean };

export type Unreached = FireThreat & { home: Home; at: Point; reason: string; skippedByStandIn: boolean };

export type FireView = { hazard: Hazard | null; danger: DangerZones | null; minutes: number };

// The fire the map draws decides it: the scenario's arrival at the home, or the forecast's band
// for the coming hour when the scenario says later but the forecast says sooner.
export function fireThreat(at: Point, fire: FireView): FireThreat | null {
  const arrival = fire.hazard ? arrivalMinutesAt(fire.hazard.field, at) : null;
  const minutesToFire = arrival === null ? null : arrival - fire.minutes;
  if (minutesToFire !== null && minutesToFire <= ALERT_WINDOW_MINUTES) return { minutesToFire, inFire: minutesToFire <= 0 };
  const likely = fire.danger ? chanceAt(fire.danger, fire.minutes + FORECAST_AHEAD_MINUTES, at) : null;
  return likely === null ? null : { minutesToFire: null, inFire: false };
}

const REASONS: Record<Home["callStatus"], (home: Home) => string> = {
  not_called: () => "Never called",
  in_call: () => "On the phone now",
  no_answer: (home) => (home.attempts > 1 ? `No answer, ${home.attempts} tries` : "No answer"),
  texted: () => "Texted, no reply",
  door_check: () => "Crew sent to knock",
  complete: () => "Called, not confirmed out",
};

// The voice stand-in plays only simulated residents. A real home it will never ring is the most
// dangerous kind of unreached, because nothing on the night will ever try it.
// `simulated === false`, not `!simulated`: a backend older than this field sends none, and an unknown
// home must never be reported as one nobody will call.
export const skippedByStandIn = (home: Home, voiceStandIn: boolean) => voiceStandIn && home.simulated === false && home.callStatus === "not_called";

// The panel's warning says why the stand-in skips a home, so its row says only "Never called".
function reasonFor(home: Home) {
  if (home.outcome === "unreachable") return "Unreachable";
  return REASONS[home.callStatus](home);
}

const soonestFirst = (a: Unreached, b: Unreached) =>
  Number(b.inFire) - Number(a.inFire) || (a.minutesToFire ?? Infinity) - (b.minutesToFire ?? Infinity);

type UnreachedInput = { homes: Home[]; withOpenRequest: Set<string>; fire: FireView; voiceStandIn: boolean; toLocal: (point: LatLng) => Point };

// A home with a ride request open is the ride list's job; every other home still home is checked here.
export function unreachedHomes({ homes, withOpenRequest, fire, voiceStandIn, toLocal }: UnreachedInput): Unreached[] {
  const list: Unreached[] = [];
  for (const home of homes) {
    if (withOpenRequest.has(home._id) || homeOccupancy(home, false) !== "stillHome") continue;
    const at = toLocal(home);
    const threat = fireThreat(at, fire);
    if (!threat) continue;
    list.push({ ...threat, home, at, reason: reasonFor(home), skippedByStandIn: skippedByStandIn(home, voiceStandIn) });
  }
  return list.sort(soonestFirst);
}

// Every real home the voice stand-in will never ring, wherever the fire is.
export const skippedCount = (homes: Home[], voiceStandIn: boolean) => homes.filter((home) => skippedByStandIn(home, voiceStandIn)).length;
