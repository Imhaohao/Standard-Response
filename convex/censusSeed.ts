import { v } from "convex/values";
import { internalMutation } from "./functions";
import { canLeave, mobility, assistanceRequired, medicalNeed } from "./schema";
import { timingForHome } from "./fireArrival";
import { mulberry32, seedFleet, FLEET, VehicleSeed } from "./seed";
import { simNow } from "./clock";

// Seeds the simulated town from the synthetic census (data/population.json) instead of the 200
// made-up homes in seed.ts, for the screen recordings (scripts/record). Every home is labeled
// simulated like the stand-in town. The caller picks the homes and their real OSM addresses;
// the need-model prior is the home's block-group rate, never its own truth card.

const censusHome = v.object({
  address: v.string(),
  lat: v.number(),
  lng: v.number(),
  callbackNumber: v.string(),
  language: v.string(),
  needPrior: v.number(),
  name: v.string(),
  age: v.number(),
  answersPhone: v.number(),
  repliesToText: v.boolean(),
  truth: v.object({
    canLeave,
    peopleCount: v.number(),
    mobility,
    assistanceRequired,
    medical: v.array(medicalNeed),
    pets: v.boolean(),
    hasCar: v.boolean(),
  }),
});

export const insertHomes = internalMutation({
  args: { homes: v.array(censusHome) },
  returns: v.number(),
  handler: async (ctx, { homes }) => {
    for (const home of homes) {
      const { fireArrivalAt, callPriority } = await timingForHome(ctx, home, home.needPrior);
      const householdId = await ctx.db.insert("households", {
        address: home.address,
        lat: home.lat,
        lng: home.lng,
        callbackNumber: home.callbackNumber,
        language: home.language,
        callStatus: "not_called",
        outcome: "unknown",
        inZone: true,
        attempts: 0,
        needPrior: home.needPrior,
        needProbability: home.needPrior,
        fireArrivalAt,
        callPriority,
        simulated: true,
      });
      const { name, age, answersPhone, repliesToText, truth } = home;
      await ctx.db.insert("personas", { householdId, name, age, answersPhone, repliesToText, truth });
    }
    return homes.length;
  },
});

// The demo fleet (Maria's and Luis's vans stay on the driver page) plus `extraVans` simulated ones.
export const insertFleet = internalMutation({
  args: { extraVans: v.number(), seed: v.number() },
  returns: v.number(),
  handler: async (ctx, { extraVans, seed }) => {
    if (await ctx.db.query("vehicles").first()) return 0;
    const drivers = ["Imani", "Victor", "Soledad", "Terrence", "Noriko", "Abel", "Fatima", "Curtis", "Inés", "Desmond", "Hana", "Rafael"];
    const extra: VehicleSeed[] = Array.from({ length: extraVans }, (_, i) => ({
      ...FLEET[2],
      label: `Van ${20 + i}`,
      driverName: drivers[i % drivers.length],
      crewSize: i % 3 === 0 ? 2 : 1,
    }));
    const fleet = [...FLEET, ...extra];
    await seedFleet(ctx, mulberry32(seed), await simNow(ctx), fleet);
    return fleet.length;
  },
});
