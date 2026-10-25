import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { householdByPhone, signUp, signUpArgs } from "./ready";
import { warningCovers } from "./riders";

// The Fetch.ai agent's two doors into the system (convex/http.ts routes them). Neither returns a
// household record: a caller who is not the dispatcher learns only what they just submitted.

// A phone number that is already on file is left alone and gets the same answer as a new one,
// so this route cannot be used to overwrite a profile or to find out who is signed up.
export const readySignUp = internalMutation({
  args: signUpArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await householdByPhone(ctx, args.phone.trim())) return null;
    await signUp(ctx, args);
    return null;
  },
});

export const warningStatus = internalQuery({
  args: { place: v.optional(v.object({ lat: v.number(), lng: v.number() })) },
  returns: v.object({ warningActive: v.boolean(), coversPlace: v.union(v.boolean(), v.null()) }),
  handler: async (ctx, { place }) => {
    const control = await ctx.db.query("control").first();
    const warningActive = control?.warningIssuedAt !== undefined;
    if (!warningActive || !place) return { warningActive, coversPlace: null };
    return { warningActive, coversPlace: await warningCovers(ctx, place) };
  },
});
