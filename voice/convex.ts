import { ConvexClient } from "convex/browser";
import { env } from "./env";

// One shared client: mutations, one-off queries and live subscriptions all go through it.
let client: ConvexClient | null = null;

export function convex() {
  client ??= new ConvexClient(env.convexUrl());
  return client;
}

// Writes the call never waits on (transcript lines, record patches). Failures are logged, not thrown,
// so a slow write can't stall a turn.
export function fireAndForget(label: string, write: Promise<unknown>) {
  write.catch((error: unknown) => console.error(`[convex] ${label} failed`, error));
}

// A failing live query (deployment disabled, function missing) would otherwise throw out of the
// client and take the whole server down, text turns included.
export const logSubscriptionError = (label: string) => (error: Error) =>
  console.error(`[convex] ${label} subscription failed`, error.message);
