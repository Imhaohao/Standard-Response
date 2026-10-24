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
import type * as dispatchStandIn from "../dispatchStandIn.js";
import type * as doorChecks from "../doorChecks.js";
import type * as events from "../events.js";
import type * as households from "../households.js";
import type * as model from "../model.js";
import type * as nominations from "../nominations.js";
import type * as offers from "../offers.js";
import type * as plans from "../plans.js";
import type * as requests from "../requests.js";
import type * as riders from "../riders.js";
import type * as roads from "../roads.js";
import type * as scripts from "../scripts.js";
import type * as seed from "../seed.js";
import type * as sim from "../sim.js";
import type * as texts from "../texts.js";
import type * as vehicles from "../vehicles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  callbacks: typeof callbacks;
  calls: typeof calls;
  control: typeof control;
  dispatchStandIn: typeof dispatchStandIn;
  doorChecks: typeof doorChecks;
  events: typeof events;
  households: typeof households;
  model: typeof model;
  nominations: typeof nominations;
  offers: typeof offers;
  plans: typeof plans;
  requests: typeof requests;
  riders: typeof riders;
  roads: typeof roads;
  scripts: typeof scripts;
  seed: typeof seed;
  sim: typeof sim;
  texts: typeof texts;
  vehicles: typeof vehicles;
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
