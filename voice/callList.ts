import { api } from "../convex/_generated/api";
import { callListKey, onCallList } from "../lib/warning-call-list";
import { convex, logSubscriptionError } from "./convex";
import { mayDial } from "./env";

// The Real phones switched on (convex/demoNumbers.ts), kept current from Convex. Empty until the
// first update arrives, so a server that just started rings nobody on the warning, not everybody.
let callList: ReadonlySet<string> = new Set();

export function setCallList(phones: readonly string[]) {
  callList = new Set(phones.map(callListKey));
}

export function watchCallList() {
  convex().onUpdate(api.demoNumbers.callList, {}, setCallList, logSubscriptionError("demoNumbers.callList"));
}

// The warning's calls, its pickup checks and its callbacks ring only the Real phones switched on.
// The Ready check, before the warning, still follows `mayDial` alone.
export const mayDialOnWarning = (phone: string) => mayDial(phone) && onCallList(phone, callList);
