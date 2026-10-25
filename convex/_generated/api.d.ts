/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentIntake from "../agentIntake.js";
import type * as agentPayload from "../agentPayload.js";
import type * as apify from "../apify.js";
import type * as apifyPayload from "../apifyPayload.js";
import type * as callPlans from "../callPlans.js";
import type * as callbacks from "../callbacks.js";
import type * as calls from "../calls.js";
import type * as censusSeed from "../censusSeed.js";
import type * as claimStatus from "../claimStatus.js";
import type * as claims from "../claims.js";
import type * as clock from "../clock.js";
import type * as control from "../control.js";
import type * as crons from "../crons.js";
import type * as demoNumbers from "../demoNumbers.js";
import type * as dispatch from "../dispatch.js";
import type * as dispatchCheck from "../dispatchCheck.js";
import type * as dispatchProblem from "../dispatchProblem.js";
import type * as dispatchSnapshot from "../dispatchSnapshot.js";
import type * as dispatchStandIn from "../dispatchStandIn.js";
import type * as dispatchWorld from "../dispatchWorld.js";
import type * as doorCheckPayload from "../doorCheckPayload.js";
import type * as doorChecks from "../doorChecks.js";
import type * as elastic from "../elastic.js";
import type * as elasticCore from "../elasticCore.js";
import type * as elasticData from "../elasticData.js";
import type * as elasticDocs from "../elasticDocs.js";
import type * as elasticHooks from "../elasticHooks.js";
import type * as escapeRoute from "../escapeRoute.js";
import type * as estimates from "../estimates.js";
import type * as events from "../events.js";
import type * as fatalityRisk from "../fatalityRisk.js";
import type * as fireArrival from "../fireArrival.js";
import type * as fleet from "../fleet.js";
import type * as functions from "../functions.js";
import type * as hazards from "../hazards.js";
import type * as heuristic from "../heuristic.js";
import type * as householdCounts from "../householdCounts.js";
import type * as households from "../households.js";
import type * as http from "../http.js";
import type * as incident from "../incident.js";
import type * as incidentPurge from "../incidentPurge.js";
import type * as languages from "../languages.js";
import type * as mesh from "../mesh.js";
import type * as model from "../model.js";
import type * as neighborCalls from "../neighborCalls.js";
import type * as neighborPickups from "../neighborPickups.js";
import type * as neighborRules from "../neighborRules.js";
import type * as nessie from "../nessie.js";
import type * as nightRuns from "../nightRuns.js";
import type * as nominations from "../nominations.js";
import type * as offers from "../offers.js";
import type * as pickupCover from "../pickupCover.js";
import type * as pickupSim from "../pickupSim.js";
import type * as pickups from "../pickups.js";
import type * as plans from "../plans.js";
import type * as prepare from "../prepare.js";
import type * as reachLadder from "../reachLadder.js";
import type * as ready from "../ready.js";
import type * as readyPairing from "../readyPairing.js";
import type * as readyProfile from "../readyProfile.js";
import type * as readySim from "../readySim.js";
import type * as reimburse from "../reimburse.js";
import type * as reimburseMiles from "../reimburseMiles.js";
import type * as requests from "../requests.js";
import type * as riders from "../riders.js";
import type * as roadGraph from "../roadGraph.js";
import type * as roads from "../roads.js";
import type * as roll from "../roll.js";
import type * as scenarioFronts from "../scenarioFronts.js";
import type * as scripts from "../scripts.js";
import type * as seed from "../seed.js";
import type * as sim from "../sim.js";
import type * as texts from "../texts.js";
import type * as traffic from "../traffic.js";
import type * as truckDrill from "../truckDrill.js";
import type * as truckRun from "../truckRun.js";
import type * as vehicleRun from "../vehicleRun.js";
import type * as vehicles from "../vehicles.js";
import type * as voice from "../voice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentIntake: typeof agentIntake;
  agentPayload: typeof agentPayload;
  apify: typeof apify;
  apifyPayload: typeof apifyPayload;
  callPlans: typeof callPlans;
  callbacks: typeof callbacks;
  calls: typeof calls;
  censusSeed: typeof censusSeed;
  claimStatus: typeof claimStatus;
  claims: typeof claims;
  clock: typeof clock;
  control: typeof control;
  crons: typeof crons;
  demoNumbers: typeof demoNumbers;
  dispatch: typeof dispatch;
  dispatchCheck: typeof dispatchCheck;
  dispatchProblem: typeof dispatchProblem;
  dispatchSnapshot: typeof dispatchSnapshot;
  dispatchStandIn: typeof dispatchStandIn;
  dispatchWorld: typeof dispatchWorld;
  doorCheckPayload: typeof doorCheckPayload;
  doorChecks: typeof doorChecks;
  elastic: typeof elastic;
  elasticCore: typeof elasticCore;
  elasticData: typeof elasticData;
  elasticDocs: typeof elasticDocs;
  elasticHooks: typeof elasticHooks;
  escapeRoute: typeof escapeRoute;
  estimates: typeof estimates;
  events: typeof events;
  fatalityRisk: typeof fatalityRisk;
  fireArrival: typeof fireArrival;
  fleet: typeof fleet;
  functions: typeof functions;
  hazards: typeof hazards;
  heuristic: typeof heuristic;
  householdCounts: typeof householdCounts;
  households: typeof households;
  http: typeof http;
  incident: typeof incident;
  incidentPurge: typeof incidentPurge;
  languages: typeof languages;
  mesh: typeof mesh;
  model: typeof model;
  neighborCalls: typeof neighborCalls;
  neighborPickups: typeof neighborPickups;
  neighborRules: typeof neighborRules;
  nessie: typeof nessie;
  nightRuns: typeof nightRuns;
  nominations: typeof nominations;
  offers: typeof offers;
  pickupCover: typeof pickupCover;
  pickupSim: typeof pickupSim;
  pickups: typeof pickups;
  plans: typeof plans;
  prepare: typeof prepare;
  reachLadder: typeof reachLadder;
  ready: typeof ready;
  readyPairing: typeof readyPairing;
  readyProfile: typeof readyProfile;
  readySim: typeof readySim;
  reimburse: typeof reimburse;
  reimburseMiles: typeof reimburseMiles;
  requests: typeof requests;
  riders: typeof riders;
  roadGraph: typeof roadGraph;
  roads: typeof roads;
  roll: typeof roll;
  scenarioFronts: typeof scenarioFronts;
  scripts: typeof scripts;
  seed: typeof seed;
  sim: typeof sim;
  texts: typeof texts;
  traffic: typeof traffic;
  truckDrill: typeof truckDrill;
  truckRun: typeof truckRun;
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

export declare const components: {
  householdsByOutcome: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"householdsByOutcome">;
  householdsByCallStatus: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"householdsByCallStatus">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
