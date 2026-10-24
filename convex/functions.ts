import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation as rawInternalMutation, mutation as rawMutation } from "./_generated/server";
import { syncHouseholdCounts } from "./householdCounts";

// Every mutation in this app comes from here, so every write to a table with a trigger also updates
// what depends on it. Importing `mutation` or `internalMutation` from ./_generated/server fails lint.

const triggers = new Triggers<DataModel>();
triggers.register("households", syncHouseholdCounts);

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
