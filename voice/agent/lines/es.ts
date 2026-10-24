import type { Lines } from "./types";

const capitalized = (sentence: string) => `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;

export const ES: Lines = {
  greetOutbound: (address, name) =>
    `Hola${name ? ` ${name}` : ""}, le llamamos de la línea de evacuación de paratránsito de Altadena. Hay una advertencia de evacuación en su calle. ¿Está usted en ${address} ahora mismo?`,
  greetInbound: "Esta es la línea de evacuación de Altadena. Puedo ayudarle a conseguir transporte para salir.",
  greetCallback: (name) => `Hola${name ? ` ${name}` : ""}, le llamamos de la línea de evacuación de Altadena con una actualización.`,
  askAddress: "¿En qué dirección está usted ahora mismo?",
  askHouseNumber: (street) => `¿Cuál es el número de la casa en ${street}?`,
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
  languageBarrier:
    "Voy a pasar su llamada a una persona de nuestro equipo. Si puede salir con seguridad, salga ahora.",
  voicemail:
    "Le llamamos de la línea de evacuación de Altadena. Hay una advertencia de evacuación en su calle. Volveremos a llamar en dos minutos. Si necesita transporte, devuelva la llamada a este número.",
  people: (count) => (count === 1 ? "una persona" : `${count} personas`),
  pets: "con mascotas",
  noCar: "sin carro",
  leavingOnOwn: "usted sale por su cuenta",
  byCar: "en carro",
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
  listSeparator: ", ",
  textPrompt:
    "Línea de evacuación de Altadena: hay una advertencia de evacuación en su calle. Responda 1 si puede salir por su cuenta, 2 si necesita transporte, 3 si necesita un vehículo para silla de ruedas. También puede escribir quién está con usted.",
  textThanks: "Gracias. Ya tenemos su respuesta.",
  backchannels: ["Mm-hm.", "Muy bien.", "A ver.", "Un momento."],
  neutralAck: "Entendido.",
  waiting:
    "Usted está en la lista de rescate con prioridad alta. Todavía ningún conductor ha aceptado. Le llamaré en cuanto uno acepte. Si puede salir con seguridad, salga ahora.",
  reassigning:
    "Su conductor ya no puede llegar a usted. Sigue en primer lugar de la lista. Le llamaré en cuanto un nuevo conductor acepte. Si puede salir con seguridad, salga ahora.",
  safety: {
    wildfire: "Si el fuego llega a su casa, llame al 911.",
    earthquake: "Si alguien está atrapado o huele a gas, llame al 911.",
    flood: "Si el agua entra en su casa, suba al piso más alto y llame al 911.",
    hurricane: "Si entra agua o su casa sufre daños, llame al 911.",
  },
  vehicle: {
    stretcher_van: "una camioneta con camilla",
    wheelchair_van: "una camioneta con acceso para silla de ruedas",
    paratransit: "una camioneta de paratránsito",
    bus: "un autobús",
    fire_unit: "un vehículo de bomberos",
    ambulance: "una ambulancia",
  },
  crew: (size) => ` con un equipo de ${size} personas`,
  minutes: (count) => (count === 1 ? "1 minuto" : `${count} minutos`),
  accepted: (vehicle, crew, eta, driverName) =>
    `${capitalized(`${vehicle}${crew} está a ${eta}.`)} El conductor se llama ${driverName}. Le llamaré otra vez si algo cambia.`,
  enRoute: (driverName, eta) => `${driverName} va manejando hacia usted, a unos ${eta}. Le llamaré otra vez si algo cambia.`,
  arrived: (shelterName) => `Su conductor ya está en su casa.${shelterName ? ` Van a ${shelterName}.` : ""}`,
};
