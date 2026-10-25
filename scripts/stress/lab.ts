// What every stress scenario shares: a pool of independent clients that fire mutations at the same
// time, typed fixtures (riders, ride requests, offers) and a ledger of invariant checks.

import { ConvexHttpClient } from "convex/browser";
import { FunctionReference, getFunctionName, makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id, TableNames } from "../../convex/_generated/dataModel";

// Each client is its own HTTP connection with its own mutation queue, like separate browsers,
// drivers' phones and the voice server.
const POOL_SIZE = 32;
const SETUP_ATTEMPTS = 8;

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

type Check = { scenario: string; ok: boolean; message: string };

// Internal functions are callable with the admin key. Typed as public so the HTTP client takes them.
export const asPublic = <R extends FunctionReference<"query" | "mutation", "internal">>(ref: R) =>
  makeFunctionReference<R["_type"], R["_args"], R["_returnType"]>(getFunctionName(ref));

// Server errors arrive as "[Request ID: …] Server Error\nUncaught Error: <message>\n    at …".
function errorMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const uncaught = text.match(/Uncaught Error: (.*)/);
  return uncaught ? uncaught[1] : text.split("\n")[0];
}

// "Documents read from or written to the \"btreeNode\" table changed while this mutation was being run
// and on every subsequent retry."
export function conflictTable(error: string) {
  if (!error.includes("OptimisticConcurrencyControlFailure")) return null;
  return error.match(/the \\?"(\w+)\\?" table/)?.[1] ?? "unknown";
}

export class Lab {
  private pool: ConvexHttpClient[];
  private next = 0;
  private stopSeq = 0;
  readonly checks: Check[] = [];
  readonly calls = { total: 0, failed: 0 };
  setupRetries = 0;
  readonly conflicts: Record<string, Record<string, number>> = {};
  scenario = "";

  constructor(url: string, adminKey: string) {
    this.pool = Array.from({ length: POOL_SIZE }, () => {
      const client = new ConvexHttpClient(url, { logger: false });
      (client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(adminKey);
      return client;
    });
  }

  private client() {
    this.next = (this.next + 1) % this.pool.length;
    return this.pool[this.next];
  }

  private async send<M extends FunctionReference<"mutation">>(ref: M, args: M["_args"]): Promise<Outcome<M["_returnType"]>> {
    this.calls.total += 1;
    try {
      return { ok: true, value: await this.client().mutation(ref, args, { skipQueue: true }) };
    } catch (error) {
      this.calls.failed += 1;
      return { ok: false, error: errorMessage(error) };
    }
  }

  // A write in the storm. When Convex retried a write conflict and still gave up, the call fails
  // whole (nothing it wrote stays), and it's tallied by the table that kept changing.
  async mutate<M extends FunctionReference<"mutation">>(ref: M, args: M["_args"]): Promise<Outcome<M["_returnType"]>> {
    const result = await this.send(ref, args);
    const table = result.ok ? null : conflictTable(result.error);
    if (table) {
      const tally = (this.conflicts[this.scenario] ??= {});
      tally[table] = (tally[table] ?? 0) + 1;
    }
    return result;
  }

  // A setup step that must work; the scenario can't run without it. Setup runs many writes at once
  // too, so it retries when Convex gives up on a write conflict. The scenarios themselves never retry.
  async must<M extends FunctionReference<"mutation">>(ref: M, args: M["_args"]): Promise<M["_returnType"]> {
    for (let attempt = 1; ; attempt++) {
      const result = await this.send(ref, args);
      if (result.ok) return result.value;
      if (!conflictTable(result.error) || attempt === SETUP_ATTEMPTS) {
        throw new Error(`${getFunctionName(ref)} failed during setup: ${result.error}`);
      }
      this.setupRetries += 1;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 50));
    }
  }

  query<Q extends FunctionReference<"query">>(ref: Q, args: Q["_args"]): Promise<Q["_returnType"]> {
    return this.client().query(ref, args);
  }

  // Every row of a table, read with the admin key the way `npx convex data` does.
  async table<T extends TableNames>(name: T): Promise<Doc<T>[]> {
    const tableData = makeFunctionReference<"query">("_system/cli/tableData");
    const rows: Doc<T>[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: { page: Doc<T>[]; isDone: boolean; continueCursor: string } = await this.client().query(tableData, {
        table: name,
        order: "asc",
        paginationOpts: { cursor, numItems: 1000 },
      });
      rows.push(...page.page);
      if (page.isDone) return rows;
      cursor = page.continueCursor;
    }
  }

  expect(ok: boolean, message: string) {
    this.checks.push({ scenario: this.scenario, ok, message });
  }

  // Stop numbers only ever grow, so a new offer always lands after every accepted stop.
  stopOrder() {
    this.stopSeq += 1;
    return this.stopSeq;
  }

  // Fictional riders imported through the agency CSV path, far enough apart to never be neighbors.
  async riders(tag: string, count: number): Promise<Id<"households">[]> {
    const header = "rider_id,name,address,lat,lng,phone,language,mobility,assistance";
    const phones = Array.from({ length: count }, () => fictionalPhone());
    const lines = phones.map((phone, i) => `${tag}-${i},Stress ${tag} ${i},${i + 1} ${tag} St,${34.0 + i * 0.03},${-118.0 - i * 0.03},${phone},en,walks,none`);
    await this.must(api.riders.importCsv, { csv: [header, ...lines].join("\n") });
    return await Promise.all(phones.map((callbackNumber) => this.must(api.households.findOrCreateByPhone, { callbackNumber })));
  }

  // A rider who can't leave: the contract opens a `received` request for them.
  async rideRequest(householdId: Id<"households">): Promise<Id<"requests">> {
    await this.must(api.households.update, { householdId, patch: { canLeave: "no", peopleCount: 1 } });
    const request = await this.query(api.requests.forHousehold, { householdId });
    if (!request) throw new Error(`No ride request opened for ${householdId}`);
    return request._id;
  }

  // One plan with one offer. With auto-approve on (the default control row) it's offered at once.
  async offer(requestId: Id<"requests">, vehicleId: Id<"vehicles">): Promise<Id<"assignments">> {
    await this.must(api.plans.propose, plan([{ requestId, vehicleId, etaMinutes: 6, stopOrder: this.stopOrder() }]));
    // Read from the table, not offers:forVehicle, so setup doesn't depend on the code under test.
    const live = (await this.table("assignments")).filter((a) => a.requestId === requestId && (a.status === "offered" || a.status === "proposed"));
    if (live.length !== 1) throw new Error(`Expected one live offer for ${requestId}, found ${live.length}`);
    return live[0]._id;
  }

  async accept(assignmentId: Id<"assignments">) {
    if ((await this.must(api.offers.accept, { assignmentId })) !== "accepted") throw new Error("Setup accept was rejected");
    return assignmentId;
  }
}

type PlanOffer = { requestId: Id<"requests">; vehicleId: Id<"vehicles">; etaMinutes: number; stopOrder: number };

export function plan(offers: PlanOffer[], replace: Id<"assignments">[] = [], revoke: Id<"assignments">[] = []) {
  return { solver: "heuristic" as const, solveMs: 1, offers, replace, revoke };
}

// 555-0100 to 555-0199 are reserved for fiction in every area code, so each number is one of those
// under a different area code. Nothing here dials them.
let phonesIssued = 0;
function fictionalPhone() {
  const n = phonesIssued++;
  return `+1${200 + Math.floor(n / 100)}55501${String(n % 100).padStart(2, "0")}`;
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function countBy<T>(items: T[], key: (item: T) => string) {
  const tally: Record<string, number> = {};
  for (const item of items) tally[key(item)] = (tally[key(item)] ?? 0) + 1;
  return tally;
}
