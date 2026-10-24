import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { seedSimulatedArea } from "./seed";

// Track C's end-to-end check (dispatch/verify_dispatch.py) on a deployment that already holds a
// real rider list. Internal only: run with `npx convex run dispatchCheck:<name>`.

// Adds a batch of 200 simulated households and personas, with fire arrival counted from now.
// Batch 1 and up use their own fake 555 numbers, so they never collide with the demo area.
export const seedSimulatedRiders = internalMutation({
  args: { batch: v.number() },
  returns: v.number(),
  handler: async (ctx, { batch }) => {
    if (!Number.isInteger(batch) || batch < 1 || batch > 8) throw new Error("batch must be an integer from 1 to 8");
    const firstNumber = `+1626555${String(1000 + batch * 200).padStart(4, "0")}`;
    const taken = await ctx.db.query("households").withIndex("by_callbackNumber", (q) => q.eq("callbackNumber", firstNumber)).first();
    if (taken) return 0;
    await seedSimulatedArea(ctx, Date.now(), { withFleet: false, batch });
    return 200;
  },
});

// After the check: takes one batch out of the zone so no dialer calls those households again.
export const parkSimulatedRiders = internalMutation({
  args: { batch: v.number() },
  returns: v.number(),
  handler: async (ctx, { batch }) => {
    const first = 1000 + batch * 200;
    let parked = 0;
    for (const household of await ctx.db.query("households").take(4000)) {
      const number = Number(household.callbackNumber.slice(-4));
      const inBatch = household.simulated && household.callbackNumber.startsWith("+1626555") && number >= first && number < first + 200;
      if (!inBatch || !household.inZone) continue;
      await ctx.db.patch("households", household._id, { inZone: false });
      parked += 1;
    }
    return parked;
  },
});

// After the check: reopens the manual single-segment closures it added since `since` (epoch ms).
export const reopenCheckClosures = internalMutation({
  args: { since: v.number() },
  returns: v.number(),
  handler: async (ctx, { since }) => {
    let reopened = 0;
    for (const closure of await ctx.db.query("roadClosures").take(1000)) {
      if (closure.source !== "manual" || closure.at < since || closure.path.length !== 2) continue;
      await ctx.db.delete("roadClosures", closure._id);
      reopened += 1;
    }
    return reopened;
  },
});
