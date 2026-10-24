/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as callbacks from "../callbacks.js";
import type * as calls from "../calls.js";
import type * as control from "../control.js";
import type * as dispatch from "../dispatch.js";
import type * as dispatchProblem from "../dispatchProblem.js";
import type * as dispatchSnapshot from "../dispatchSnapshot.js";
import type * as dispatchStandIn from "../dispatchStandIn.js";
import type * as dispatchWorld from "../dispatchWorld.js";
import type * as doorChecks from "../doorChecks.js";
import type * as estimates from "../estimates.js";
import type * as events from "../events.js";
import type * as fleet from "../fleet.js";
import type * as heuristic from "../heuristic.js";
import type * as households from "../households.js";
import type * as model from "../model.js";
import type * as nominations from "../nominations.js";
import type * as offers from "../offers.js";
import type * as plans from "../plans.js";
import type * as requests from "../requests.js";
import type * as riders from "../riders.js";
import type * as roadGraph from "../roadGraph.js";
import type * as roads from "../roads.js";
import type * as scripts from "../scripts.js";
import type * as seed from "../seed.js";
import type * as sim from "../sim.js";
import type * as texts from "../texts.js";
import type * as vehicleRun from "../vehicleRun.js";
import type * as vehicles from "../vehicles.js";
import type * as voice from "../voice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  callbacks: typeof callbacks;
  calls: typeof calls;
  control: typeof control;
  dispatch: typeof dispatch;
  dispatchProblem: typeof dispatchProblem;
  dispatchSnapshot: typeof dispatchSnapshot;
  dispatchStandIn: typeof dispatchStandIn;
  dispatchWorld: typeof dispatchWorld;
  doorChecks: typeof doorChecks;
  estimates: typeof estimates;
  events: typeof events;
  fleet: typeof fleet;
  heuristic: typeof heuristic;
  households: typeof households;
  model: typeof model;
  nominations: typeof nominations;
  offers: typeof offers;
  plans: typeof plans;
  requests: typeof requests;
  riders: typeof riders;
  roadGraph: typeof roadGraph;
  roads: typeof roads;
  scripts: typeof scripts;
  seed: typeof seed;
  sim: typeof sim;
  texts: typeof texts;
  vehicleRun: typeof vehicleRun;
  vehicles: typeof vehicles;
  voice: typeof voice;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
