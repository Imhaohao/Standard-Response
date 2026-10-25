// Drives the night through Convex functions, never through the UI, so the scenes survive a restyle.
// Internal functions are called with the local backend's admin key.

import { ConvexHttpClient } from "convex/browser";
import { FunctionReference, getFunctionName, makeFunctionReference } from "convex/server";
import { api, internal } from "../../convex/_generated/api";
import { censusTown } from "./census";

const asPublic = <R extends FunctionReference<"query" | "mutation", "internal">>(ref: R) =>
  makeFunctionReference<R["_type"], R["_args"], R["_returnType"]>(getFunctionName(ref));

const SEED_BATCH = 100;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      if (await check()) return;
      await sleep(everyMs);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  private async archiveDone() {
    const control = await this.query(api.control.get, {});
    return !("archivingRunId" in control) || !control.archivingRunId;
  }

  // Clears the deployment (the night and the homes), then seeds `homes` census households and the fleet.
  async freshTown(root: string, homes: number, extraVans: number) {
    await this.waitUntil("the last night to finish saving", () => this.archiveDone());
    await this.mutation(api.control.reset, {});
    await this.waitUntil("reset to finish", () => this.archiveDone(), 600_000);
    await this.mutation(api.control.setStandIns, { simulateVoice: true, simulateNeedModel: true, simulateDispatch: false, simulateDrivers: true, autoApprove: true });
    await this.countsFromAggregates();
    const town = censusTown(root, homes);
    for (let i = 0; i < town.length; i += SEED_BATCH) {
      await this.mutation(asPublic(internal.censusSeed.insertHomes), { homes: town.slice(i, i + SEED_BATCH) });
    }
    await this.mutation(asPublic(internal.censusSeed.insertFleet), { extraVans, seed: 13 });
    return town.length;
  }

  // Switches households:counts to the running totals. On an empty table the backfill only clears;
  // it refuses while the aggregate's queue still holds the reset's deletes, so it is retried.
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

  async setSpeed(speed: 0 | 1 | 10 | 30 | 60) {
    await this.mutation(api.control.setPlayback, { speed });
  }

  async counts() {
    return await this.query(api.households.counts, {});
  }
}
