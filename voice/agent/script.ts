import type { Doc } from "../../convex/_generated/dataModel";
import type { AssignedDriver } from "../../convex/voice";
import type { AgentRecord } from "./record";

// Everything the agent may say that isn't Claude's short acknowledgment. Status lines are fixed
// templates: Claude never writes an ETA, a driver's name, or a promise.

export type Language = "en" | "es";
export type RequestStatus = Doc<"requests">["status"];

export const languageOf = (value: string | undefined): Language => (value === "es" ? "es" : "en");

type Mobility = NonNullable<AgentRecord["mobility"]>;
type Assistance = NonNullable<AgentRecord["assistanceRequired"]>;

type Lines = {
  greetOutbound: (address: string, name?: string) => string;
  greetInbound: string;
  greetCallback: (name?: string) => string;
  askAddress: string;
  confirmAddress: (address: string) => string;
  addressRetry: string;
  addressEscalated: string;
  askCanLeave: string;
  askHasCar: string;
  askHousehold: string;
  askNeeds: string;
  askNeedsOnFile: (onFile: string) => string;
  askAssistance: string;
  readbackIntro: string;
  readbackQuestion: string;
  readbackFixed: string;
  whatToFix: string;
  askNeighbor: string;
  leaveNow: string;
  goodbye: string;
  repeatPrompt: string;
  emergency: string;
  voicemail: string;
  people: (count: number) => string;
  pets: string;
  noCar: string;
  mobility: Record<Mobility, string>;
  assistance: Record<Assistance, string>;
  oxygen: string;
  atAddress: (address: string) => string;
  textPrompt: string;
  textThanks: string;
};

const EN: Lines = {
  greetOutbound: (address, name) =>
    `Hello${name ? ` ${name}` : ""}, this is the Altadena paratransit evacuation line. An evacuation warning covers your street. Are you at ${address} right now?`,
  greetInbound: "This is the Altadena evacuation line. I can help get you a ride out.",
  greetCallback: (name) => `Hello${name ? ` ${name}` : ""}, this is the Altadena evacuation line with an update.`,
  askAddress: "What address are you at right now?",
  confirmAddress: (address) => `I have ${address}. Is that right?`,
  addressRetry: "Sorry, I didn't catch that. Can you tell me the street address where you are now?",
  addressEscalated: "I've flagged your address for a dispatcher to confirm. If you can, also call 911.",
  askCanLeave: "Can everyone in your home leave on their own right now?",
  askHasCar: "Do you have a car or someone who can drive you out?",
  askHousehold: "How many people are with you right now, and are there any pets?",
  askNeeds: "Does anyone there use a walker or a wheelchair, need oxygen, or stay in bed?",
  askNeedsOnFile: (onFile) => `Our records say ${onFile}. Is that still right, and does anyone need oxygen?`,
  askAssistance: "How much help do they need getting out: none, one person helping, or two people to lift?",
  readbackIntro: "Let me read that back.",
  readbackQuestion: "Is that right?",
  readbackFixed: "Thanks, I've fixed that.",
  whatToFix: "What should I change?",
  askNeighbor: "Is there anyone else on your street who might not be able to leave? If so, what's their address?",
  leaveNow: "Please leave now, and take your medications and phone charger.",
  goodbye: "Thank you. Stay by the phone. Goodbye.",
  repeatPrompt: "Sorry, could you say that again?",
  emergency: "If you can, call 911 right now. I've marked you urgent for the dispatcher.",
  voicemail:
    "This is the Altadena evacuation line. An evacuation warning covers your street. We'll call back in two minutes. If you need a ride out, call this number back.",
  people: (count) => (count === 1 ? "one person" : `${count} people`),
  pets: "with pets",
  noCar: "no car",
  mobility: {
    walks: "everyone can walk",
    walker: "someone uses a walker",
    manual_wheelchair: "someone uses a wheelchair",
    power_wheelchair: "someone uses a power wheelchair",
    bedbound: "someone is bedbound",
  },
  assistance: {
    none: "no help needed getting out",
    one_person_assist: "needs one person to help",
    two_person_lift: "needs two people to lift",
  },
  oxygen: "on oxygen",
  atAddress: (address) => `at ${address}`,
  textPrompt:
    "Altadena evacuation line: an evacuation warning covers your street. Reply 1 if you can leave on your own, 2 if you need a ride, 3 if you need a wheelchair-accessible vehicle. You can also write who is with you.",
  textThanks: "Thank you. We have your answer.",
};

const ES: Lines = {
  greetOutbound: (address, name) =>
    `Hola${name ? ` ${name}` : ""}, le llamamos de la línea de evacuación de paratránsito de Altadena. Hay una advertencia de evacuación en su calle. ¿Está usted en ${address} ahora mismo?`,
  greetInbound: "Esta es la línea de evacuación de Altadena. Puedo ayudarle a conseguir transporte para salir.",
  greetCallback: (name) => `Hola${name ? ` ${name}` : ""}, le llamamos de la línea de evacuación de Altadena con una actualización.`,
  askAddress: "¿En qué dirección está usted ahora mismo?",
  confirmAddress: (address) => `Tengo ${address}. ¿Es correcto?`,
  addressRetry: "Perdón, no le entendí. ¿Me puede decir la dirección donde está ahora?",
  addressEscalated: "Marqué su dirección para que un despachador la confirme. Si puede, llame también al 911.",
  askCanLeave: "¿Pueden todos en su casa salir por su cuenta ahora mismo?",
  askHasCar: "¿Tiene carro o alguien que le pueda llevar?",
  askHousehold: "¿Cuántas personas están con usted ahora, y tienen mascotas?",
  askNeeds: "¿Alguien usa andadera o silla de ruedas, necesita oxígeno o está en cama?",
  askNeedsOnFile: (onFile) => `Nuestros registros dicen que ${onFile}. ¿Sigue siendo así, y alguien necesita oxígeno?`,
  askAssistance: "¿Cuánta ayuda necesita para salir: ninguna, una persona que le ayude, o dos personas para levantarle?",
  readbackIntro: "Le confirmo lo que tengo.",
  readbackQuestion: "¿Es correcto?",
  readbackFixed: "Gracias, ya lo corregí.",
  whatToFix: "¿Qué debo corregir?",
  askNeighbor: "¿Hay alguien más en su calle que tal vez no pueda salir? Si es así, ¿cuál es su dirección?",
  leaveNow: "Por favor salga ahora, y lleve sus medicinas y el cargador del teléfono.",
  goodbye: "Gracias. Quédese cerca del teléfono. Adiós.",
  repeatPrompt: "Perdón, ¿me lo puede repetir?",
  emergency: "Si puede, llame al 911 ahora mismo. Le marqué como urgente para el despachador.",
  voicemail:
    "Le llamamos de la línea de evacuación de Altadena. Hay una advertencia de evacuación en su calle. Volveremos a llamar en dos minutos. Si necesita transporte, devuelva la llamada a este número.",
  people: (count) => (count === 1 ? "una persona" : `${count} personas`),
  pets: "con mascotas",
  noCar: "sin carro",
  mobility: {
    walks: "todos pueden caminar",
    walker: "alguien usa andadera",
    manual_wheelchair: "alguien usa silla de ruedas",
    power_wheelchair: "alguien usa silla de ruedas eléctrica",
    bedbound: "alguien está en cama",
  },
  assistance: {
    none: "no necesita ayuda para salir",
    one_person_assist: "necesita una persona que le ayude",
    two_person_lift: "necesita dos personas para levantarle",
  },
  oxygen: "con oxígeno",
  atAddress: (address) => `en ${address}`,
  textPrompt:
    "Línea de evacuación de Altadena: hay una advertencia de evacuación en su calle. Responda 1 si puede salir por su cuenta, 2 si necesita transporte, 3 si necesita un vehículo para silla de ruedas. También puede escribir quién está con usted.",
  textThanks: "Gracias. Ya tenemos su respuesta.",
};

export const LINES: Record<Language, Lines> = { en: EN, es: ES };

export function readback(record: AgentRecord, language: Language) {
  const lines = LINES[language];
  const parts = [
    record.peopleCount !== undefined ? lines.people(record.peopleCount) : undefined,
    record.mobility ? lines.mobility[record.mobility] : undefined,
    record.medical?.includes("oxygen") ? lines.oxygen : undefined,
    record.assistanceRequired && record.assistanceRequired !== "none" ? lines.assistance[record.assistanceRequired] : undefined,
    record.pets ? lines.pets : undefined,
    record.hasCar === false ? lines.noCar : undefined,
    record.address ? lines.atAddress(record.address) : undefined,
  ].filter((part): part is string => part !== undefined);
  const summary = parts.join(", ");
  return `${lines.readbackIntro} ${summary.charAt(0).toUpperCase()}${summary.slice(1)}. ${lines.readbackQuestion}`;
}

// What the resident is told about their ride, by request status. The table in PLAN.md
// "Request status and what the agent may say" is the source; change both together.

const WAITING = {
  en: "You're on the rescue list as high priority. No driver has accepted yet. I'll call you back the moment one does. If you can leave safely, leave now. If fire reaches your home, call 911.",
  es: "Usted está en la lista de rescate con prioridad alta. Todavía ningún conductor ha aceptado. Le llamaré en cuanto uno acepte. Si puede salir con seguridad, salga ahora. Si el fuego llega a su casa, llame al 911.",
};

const REASSIGNING = {
  en: "Your driver can no longer reach you. You're still at the top of the list. I'll call the moment a new driver accepts. If you can leave safely, leave now. If fire reaches your home, call 911.",
  es: "Su conductor ya no puede llegar a usted. Sigue en primer lugar de la lista. Le llamaré en cuanto un nuevo conductor acepte. Si puede salir con seguridad, salga ahora. Si el fuego llega a su casa, llame al 911.",
};

type VehicleWords = { en: string; es: string };

const VEHICLE_WORDS: Record<AssignedDriver["vehicleType"], VehicleWords> = {
  paratransit: { en: "paratransit van", es: "una camioneta de paratránsito" },
  bus: { en: "bus", es: "un autobús" },
  fire_unit: { en: "fire department vehicle", es: "un vehículo de bomberos" },
  ambulance: { en: "ambulance", es: "una ambulancia" },
};

function vehicleWords(driver: AssignedDriver, language: Language) {
  if (driver.stretcherSpaces > 0 && driver.vehicleType !== "ambulance") {
    return language === "en" ? "van that carries a stretcher" : "una camioneta con camilla";
  }
  if (driver.wheelchairSpaces > 0 && driver.vehicleType === "paratransit") {
    return language === "en" ? "wheelchair-accessible van" : "una camioneta con acceso para silla de ruedas";
  }
  return VEHICLE_WORDS[driver.vehicleType][language];
}

function crewWords(driver: AssignedDriver, language: Language) {
  if (driver.crewSize < 2) return "";
  if (language === "en") return driver.crewSize === 2 ? " with a two-person crew" : ` with a ${driver.crewSize}-person crew`;
  return ` con un equipo de ${driver.crewSize} personas`;
}

const minutesWords = (eta: number, language: Language) => {
  const minutes = Math.max(1, Math.round(eta));
  if (language === "en") return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
};

function acceptedLine(driver: AssignedDriver, language: Language) {
  const vehicle = vehicleWords(driver, language);
  const crew = crewWords(driver, language);
  const eta = minutesWords(driver.etaMinutes, language);
  if (language === "en") {
    const article = /^[aeiou]/i.test(vehicle) ? "An" : "A";
    return `${article} ${vehicle}${crew} is ${eta} away. The driver's name is ${driver.name}. I'll call again if anything changes.`;
  }
  const sentence = `${vehicle}${crew} está a ${eta}.`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} El conductor se llama ${driver.name}. Le llamaré otra vez si algo cambia.`;
}

function enRouteLine(driver: AssignedDriver, language: Language) {
  const eta = minutesWords(driver.etaMinutes, language);
  if (language === "en") return `${driver.name} is driving to you now, about ${eta} away. I'll call again if anything changes.`;
  return `${driver.name} va manejando hacia usted, a unos ${eta}. Le llamaré otra vez si algo cambia.`;
}

function arrivedLine(driver: AssignedDriver | null, language: Language) {
  const shelter = driver?.shelterName;
  if (language === "en") return `Your driver is at your home now.${shelter ? ` You're going to ${shelter}.` : ""}`;
  return `Su conductor ya está en su casa.${shelter ? ` Van a ${shelter}.` : ""}`;
}

export type RideStatus = { status: RequestStatus; driver: AssignedDriver | null } | null;

// The only sentence the agent may say about a ride. `null` means there's no ride request.
export function statusLine(ride: RideStatus, language: Language): string | null {
  if (!ride) return null;
  const { status, driver } = ride;
  if (status === "reassigning") return REASSIGNING[language];
  if (status === "arrived" || status === "closed") return arrivedLine(driver, language);
  if (!driver || status === "received" || status === "approved") return WAITING[language];
  return status === "en_route" ? enRouteLine(driver, language) : acceptedLine(driver, language);
}
