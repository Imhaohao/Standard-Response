/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import aggregateTest from "@convex-dev/aggregate/test";
import batchWorkerTest from "@convex-dev/batch-worker/test";

type AnyConvexTest = TestConvex<SchemaDefinition<GenericSchema, boolean>>;

// The call-floor count aggregates queue their writes (convex/householdCounts.ts), which runs on a
// nested batch worker. Aggregate's own test helper doesn't register that one, so this does.
export function registerHouseholdCounts<T>(t: T) {
  for (const name of ["householdsByOutcome", "householdsByCallStatus"]) {
    aggregateTest.register(t as unknown as AnyConvexTest, name);
    batchWorkerTest.register(t as unknown as AnyConvexTest, `${name}/batchWorker`);
  }
}
