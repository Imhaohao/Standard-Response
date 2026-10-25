// The only phones an evacuation warning rings: the numbers switched on in the call floor's Real phones
// list (convex/demoNumbers.ts). Anyone else with a real number on a house, like a judge who signed up
// at the kiosk, keeps the house but hears nothing from the warning, its pickup checks or its callbacks.

// Digits only, so "+1 (650) 223-4376" and "6502234376" are the same phone.
export function callListKey(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `1${digits}` : digits;
}

export const onCallList = (phone: string, callList: ReadonlySet<string>) => callList.has(callListKey(phone));
