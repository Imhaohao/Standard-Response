import { GenericDatabaseReader } from "convex/server";
import { DataModel } from "./_generated/dataModel";
import { simTime } from "../lib/sim-clock";

// The time on the night's clock, which the rescue map can pause or speed up (lib/sim-clock.ts).
// Use it for every time stored or compared. Keep Date.now() for measuring how long code takes and
// for limits on how often something runs, like the solver's re-plan cadence.
export async function simNow(ctx: { db: GenericDatabaseReader<DataModel> }) {
  const control = await ctx.db.query("control").first();
  return simTime(control?.clock, Date.now());
}
