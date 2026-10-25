// Kiosk registrations alternate so every second participant has a helper available.
export function demoProfileFor(position: number) {
  const driver = position % 2 === 0;
  return {
    canLeave: driver ? "yes" as const : "no" as const,
    peopleCount: 1,
    mobility: driver ? "walks" as const : "bedbound" as const,
    assistanceRequired: driver ? "none" as const : "one_person_assist" as const,
    hasCar: driver,
    medical: [],
    pets: false,
  };
}
