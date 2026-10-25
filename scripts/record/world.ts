// Drives the night through Convex functions, never through the UI, so the scenes survive a restyle.
// Internal functions are called with the local backend's admin key.

import { ConvexHttpClient } from "convex/browser";
import { FunctionReference, getFunctionName, makeFunctionReference } from "convex/server";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AREA } from "../../convex/model";
import { censusTown } from "./census";

const asPublic = <R extends FunctionReference<"query" | "mutation", "internal">>(ref: R) =>
  makeFunctionReference<R["_type"], R["_args"], R["_returnType"]>(getFunctionName(ref));

const SEED_BATCH = 100;

export type Speed = 0 | 1 | 10 | 30 | 60;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The warning zone as a dispatcher would draw it: west Altadena between the foothills and
// Woodbury, a little inside the calling area so its edge reads on the map.
const WARNING_ZONE = [
  { lat: AREA.north - 0.001, lng: AREA.west + 0.0015 },
  { lat: AREA.north - 0.0005, lng: AREA.east - 0.003 },
  { lat: (AREA.north + AREA.south) / 2, lng: AREA.east - 0.001 },
  { lat: AREA.south + 0.001, lng: AREA.east - 0.002 },
  { lat: AREA.south + 0.0015, lng: AREA.west + 0.001 },
  { lat: (AREA.north + AREA.south) / 2 + 0.002, lng: AREA.west + 0.0005 },
];

export class World {
  readonly client: ConvexHttpClient;

  constructor(url: string, adminKey: string) {
    this.client = new ConvexHttpClient(url, { logger: false });
    (this.client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(adminKey);
  }

  query<Q extends FunctionReference<"query">>(ref: Q, args: Q["_args"]): Promise<Q["_returnType"]> {
    return this.client.query(ref, args);
  }

  mutation<M extends FunctionReference<"mutation">>(ref: M, args: M["_args"]): Promise<M["_returnType"]> {
    return this.client.mutation(ref, args);
  }

  async waitUntil(label: string, check: () => Promise<boolean>, timeoutMs = 120_000, everyMs = 500) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await check()) return true;
      await sleep(everyMs);
    }
    console.warn(`  (gave up waiting for ${label} after ${timeoutMs / 1000}s)`);
    return false;
  }

  // On an empty deployment: the stand-ins on (the dispatch stand-in off, so the real dispatcher and
  // solver plan), `homes` census households, and the fleet.
  async seedTown(root: string, homes: number, extraVans: number) {
    await this.mutation(api.control.setStandIns, { simulateVoice: true, simulateNeedModel: true, simulateDispatch: false, simulateDrivers: true, autoApprove: true });
    await this.mutation(api.control.setMaxConcurrentCalls, { value: 48 });
    await this.countsFromAggregates();
    const town = censusTown(root, homes);
    for (let i = 0; i < town.length; i += SEED_BATCH) {
      await this.mutation(asPublic(internal.censusSeed.insertHomes), { homes: town.slice(i, i + SEED_BATCH) });
    }
    await this.mutation(asPublic(internal.censusSeed.insertFleet), { extraVans, seed: 13 });
    return town.length;
  }

  // Switches households:counts to the running totals. It refuses while the aggregate's queue is busy.
  private async countsFromAggregates() {
    await this.waitUntil("the household counts to switch on", async () => {
      try {
        await this.mutation(asPublic(internal.householdCounts.backfill), {});
        return true;
      } catch (error) {
        if (String(error).includes("PENDING_OPERATIONS")) return false;
        throw error;
      }
    }, 120_000, 1000);
  }

  setSpeed(speed: Speed) {
    return this.mutation(api.control.setPlayback, { speed });
  }

  setAutoApprove(autoApprove: boolean) {
    return this.mutation(api.control.setStandIns, { autoApprove });
  }

  startReadyCheck() {
    return this.mutation(api.ready.start, {});
  }

  stopReadyCheck() {
    return this.mutation(api.ready.stop, {});
  }

  drawWarningZone() {
    return this.mutation(api.riders.setZone, { polygon: WARNING_ZONE });
  }

  issueWarning() {
    return this.mutation(api.control.issueWarning, {});
  }

  control() {
    return this.query(api.control.get, {});
  }

  counts() {
    return this.query(api.households.counts, {});
  }

  openRequests() {
    return this.query(api.requests.open, {});
  }

  latestPlan() {
    return this.query(api.plans.latest, {});
  }

  async vehicleOf(driverName: string): Promise<Id<"vehicles">> {
    const vehicles = await this.query(api.vehicles.list, {});
    const vehicle = vehicles.find((v) => v.driverName === driverName);
    if (!vehicle) throw new Error(`No vehicle driven by ${driverName}`);
    return vehicle._id;
  }

  offersFor(vehicleId: Id<"vehicles">) {
    return this.query(api.offers.forVehicle, { vehicleId });
  }

  // Homes the Ready check has a profile for.
  async readyProfiles() {
    const homes = await this.query(api.households.coverage, {});
    return homes.filter((home) => home.exitPlan !== undefined).length;
  }

  async reached() {
    const { outcome } = await this.counts();
    return Object.entries(outcome).reduce((sum, [key, count]) => (key === "unknown" ? sum : sum + count), 0);
  }
}
