import { Doc } from "./_generated/dataModel";
import { RecordPatch } from "./households";

// Stand-in conversation for simulated residents. The real voice agent (Track B) replaces
// this with Claude + speech; the stage order matches the plan's state machine.

type Truth = Doc<"personas">["truth"];
type Stage = Doc<"calls">["stage"];
type Language = "en" | "es";

export type ScriptStep = {
  speaker: "agent" | "resident";
  stage: Stage;
  text: string;
  patch?: RecordPatch;
};

type Phrasebook = {
  greet: (address: string) => string;
  confirm: (address: string) => string;
  askLeave: string;
  canLeave: Record<Truth["canLeave"], string>;
  askHousehold: string;
  household: (people: number, pets: boolean) => string;
  askNeeds: string;
  mobility: Record<Truth["mobility"], string>;
  oxygen: string;
  twoPersonLift: string;
  readback: (people: number, address: string) => string;
  confirmReadback: string;
  closeLeaving: string;
  closeVehicle: string;
};

const PHRASES: Record<Language, Phrasebook> = {
  en: {
    greet: (address) =>
      `Hello, this is the Altadena evacuation line. An evacuation warning is in effect. Am I speaking with someone at ${address}?`,
    confirm: (address) => `Yes, this is ${address}.`,
    askLeave: "Can everyone in your home leave on their own right now?",
    canLeave: {
      yes: "Yes, we can drive out.",
      no: "No. I can't get out by myself.",
      unsure: "I'm not sure. I don't know how I would get out.",
    },
    askHousehold: "How many people are with you, and are there any pets?",
    household: (people, pets) => `${people === 1 ? "Just me" : `${people} of us`}${pets ? ", and a dog." : ", no pets."}`,
    askNeeds: "Does anyone use a walker or wheelchair, or need oxygen or other medical equipment?",
    mobility: {
      walks: "Everyone can walk fine.",
      walker: "I use a walker.",
      manual_wheelchair: "I use a wheelchair.",
      power_wheelchair: "I use a power wheelchair.",
      bedbound: "One of us is bedbound.",
    },
    oxygen: " I'm on oxygen.",
    twoPersonLift: " It takes two people to lift me out of bed.",
    readback: (people, address) => `Let me read that back. ${people === 1 ? "1 person" : `${people} people`} at ${address}. Is that right?`,
    confirmReadback: "Yes, that's right.",
    closeLeaving: "Thank you. Please leave now and head south on Lincoln Avenue.",
    closeVehicle: "Thank you. We are arranging a vehicle and will call you back with the driver's name. Please stay by the phone.",
  },
  es: {
    greet: (address) =>
      `Hola, le llamamos de la línea de evacuación de Altadena. Hay una advertencia de evacuación. ¿Hablo con alguien en ${address}?`,
    confirm: (address) => `Sí, es ${address}.`,
    askLeave: "¿Pueden todos en su casa salir por su cuenta ahora mismo?",
    canLeave: {
      yes: "Sí, podemos salir en carro.",
      no: "No. No puedo salir sola.",
      unsure: "No sé. No sé cómo saldría.",
    },
    askHousehold: "¿Cuántas personas están con usted, y tienen mascotas?",
    household: (people, pets) => `${people === 1 ? "Solo yo" : `Somos ${people}`}${pets ? ", y un perro." : ", sin mascotas."}`,
    askNeeds: "¿Alguien usa andadera o silla de ruedas, o necesita oxígeno u otro equipo médico?",
    mobility: {
      walks: "Todos podemos caminar bien.",
      walker: "Uso andadera.",
      manual_wheelchair: "Uso silla de ruedas.",
      power_wheelchair: "Uso una silla de ruedas eléctrica.",
      bedbound: "Una persona está en cama y no puede levantarse.",
    },
    oxygen: " Uso oxígeno.",
    twoPersonLift: " Se necesitan dos personas para levantarme de la cama.",
    readback: (people, address) => `Le confirmo: ${people === 1 ? "1 persona" : `${people} personas`} en ${address}. ¿Es correcto?`,
    confirmReadback: "Sí, es correcto.",
    closeLeaving: "Gracias. Por favor salgan ahora hacia el sur por Lincoln Avenue.",
    closeVehicle: "Gracias. Estamos organizando un vehículo y le llamaremos con el nombre del conductor. Quédese cerca del teléfono.",
  },
};

function phrasebookFor(language: string) {
  return PHRASES[language as Language] ?? PHRASES.en;
}

const NEEDS_VEHICLE = (truth: Truth) => truth.canLeave !== "yes" || truth.mobility !== "walks" || !truth.hasCar;

// The resident's answer to "does anyone use a walker or wheelchair, or need oxygen?"
export function needsLineFor(language: string, truth: Truth) {
  const p = phrasebookFor(language);
  return (
    p.mobility[truth.mobility] +
    (truth.medical.includes("oxygen") ? p.oxygen : "") +
    (truth.assistanceRequired === "two_person_lift" ? p.twoPersonLift : "")
  );
}

export function scriptFor(address: string, language: string, truth: Truth): ScriptStep[] {
  const p = phrasebookFor(language);
  const needsLine = needsLineFor(language, truth);
  return [
    { speaker: "agent", stage: "greet", text: p.greet(address) },
    { speaker: "resident", stage: "confirm_address", text: p.confirm(address), patch: { address } },
    { speaker: "agent", stage: "can_leave", text: p.askLeave },
    { speaker: "resident", stage: "can_leave", text: p.canLeave[truth.canLeave], patch: { canLeave: truth.canLeave } },
    { speaker: "agent", stage: "household", text: p.askHousehold },
    {
      speaker: "resident",
      stage: "household",
      text: p.household(truth.peopleCount, truth.pets),
      patch: { peopleCount: truth.peopleCount, pets: truth.pets },
    },
    { speaker: "agent", stage: "needs", text: p.askNeeds },
    {
      speaker: "resident",
      stage: "needs",
      text: needsLine,
      patch: {
        mobility: truth.mobility,
        assistanceRequired: truth.assistanceRequired,
        medical: truth.medical,
        hasCar: truth.hasCar,
      },
    },
    { speaker: "agent", stage: "readback", text: p.readback(truth.peopleCount, address) },
    { speaker: "resident", stage: "readback", text: p.confirmReadback },
    { speaker: "agent", stage: "close", text: NEEDS_VEHICLE(truth) ? p.closeVehicle : p.closeLeaving },
  ];
}
