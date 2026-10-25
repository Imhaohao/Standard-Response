// The only phones an evacuation warning rings: the team's own. Anyone else with a real number on a
// house, like a judge who signed up at the kiosk, keeps the house but hears nothing from the warning,
// its pickup checks or its callbacks.
const WARNING_CALL_LIST: ReadonlySet<string> = new Set([
  "14252468208", // David
  "16502234376", // Boris
  "16507099911", // Brendan
  "16506567040", // Jerry
]);

// Compares digits only, so "+1 (650) 223-4376" and "6502234376" both match.
export function onWarningCallList(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return WARNING_CALL_LIST.has(digits.length === 10 ? `1${digits}` : digits);
}
