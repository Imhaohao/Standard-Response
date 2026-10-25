import type { Interpretation } from "./interpreter";
import type { Language } from "./script";

// Answers the agency has approved for questions residents ask mid-call ("Can my dog come?"), and
// the safety answers for the dangerous ones ("Can I go back in for my cat?"). Moss (answerLookup.ts)
// picks which one fits; the words spoken are always these, never Claude's, and code decides which
// answers a question may get at all (mayGetApprovedAnswer). Every answer is fictional agency policy
// for the demo, and each one passes the honesty guard (approvedAnswers.test.ts), so none of them can
// sound like a promise of a ride.

export type ApprovedAnswerId =
  | "pets"
  | "oxygen"
  | "medications"
  | "wheelchair"
  | "walker"
  | "scooter"
  | "caregiver"
  | "dialysis"
  | "documents"
  | "shelter_supplies"
  | "cost"
  | "go_back_inside"
  | "go_get_someone"
  | "medical_change"
  | "trapped_by_fire"
  | "smoke_inside"
  | "heat_inside"
  | "oxygen_near_fire";

type BankLanguage = Extract<Language, "en" | "es">;

type ApprovedAnswer = {
  answer: Record<BankLanguage, string>;
  // Ways a resident asks it, in English. Claude restates every policy question in English
  // (Interpretation.policyQuestion), so these match a question asked in any call language.
  questions: string[];
  // A safety answer, for a question that would send someone back toward danger or change a
  // treatment. It may answer only the unsafe questions named here, and nothing else may answer them.
  safetyFor?: UnsafeKind;
};

// What makes a question dangerous to answer from the agency's ordinary policy answers.
// fire_at_home: fire, smoke or heat has reached them where they are. Only the fire-safety steps may
// answer that; an ordinary answer ("bring your medications") would waste the turn.
type UnsafeKind = "toward_danger" | "staying" | "medical_change" | "fire_at_home";

export const APPROVED_ANSWERS: Record<ApprovedAnswerId, ApprovedAnswer> = {
  pets: {
    answer: {
      en: "Pets can come with you. Keep dogs on a leash, and cats in a carrier if you have one.",
      es: "Sus mascotas pueden ir con usted. Los perros con correa, y los gatos en un transportador si tiene uno.",
    },
    questions: ["Can I bring my dog?", "Can I bring my cat?", "Can my pets come with me?", "What do I do with my pets?", "Can I take my bird?", "Is my service dog allowed?"],
  },
  oxygen: {
    answer: {
      en: "If you leave, take your oxygen with you. Bring any spare tanks, and the charger if it's a concentrator.",
      es: "Cuando salga, lleve su oxígeno con usted. Traiga los tanques de repuesto, y el cargador si es un concentrador.",
    },
    questions: ["Can I bring my oxygen tank?", "Can he bring his oxygen?", "Can I take my oxygen concentrator?", "What do I do about my oxygen?", "Can the oxygen come with us?", "Can my oxygen come?"],
  },
  medications: {
    answer: {
      en: "Bring every medication in its bottle, and your list of doses if you have one.",
      es: "Traiga todos sus medicamentos en sus frascos, y su lista de dosis si la tiene.",
    },
    questions: ["Should I bring my medications?", "Can I bring my pills?", "Should I bring my prescriptions?", "Do I need to bring my insulin?", "Should I grab my prescriptions?", "Can my medicine come with me?"],
  },
  wheelchair: {
    answer: {
      en: "The wheelchair comes with you, powered chairs too.",
      es: "La silla de ruedas va con usted, también las eléctricas.",
    },
    questions: ["Can I bring my wheelchair?", "Will a power wheelchair fit?", "Is there room for an electric wheelchair?", "Do I have to leave my wheelchair behind?"],
  },
  walker: {
    answer: {
      en: "A walker or cane can come with you. There's room for it.",
      es: "La andadera o el bastón pueden ir con usted. Hay lugar para eso.",
    },
    questions: ["Can I bring my walker?", "Can I bring my cane?"],
  },
  scooter: {
    answer: {
      en: "A mobility scooter can come if it folds or fits on the lift. If it doesn't, bring a wheelchair if you have one.",
      es: "Un scooter de movilidad puede ir si se dobla o cabe en el elevador. Si no, traiga una silla de ruedas si tiene una.",
    },
    questions: ["Can I bring my mobility scooter?", "Will my scooter fit?"],
  },
  caregiver: {
    answer: {
      en: "A caregiver or family member can ride with you.",
      es: "Un cuidador o un familiar puede ir con usted.",
    },
    questions: ["Can my caregiver come with me?", "Can my daughter ride with me?", "Can a family member come along?", "Can my aide come too?", "Can I go with my husband?", "Can my son come with me?", "Can my granddaughter come?", "Can my mother ride with me?"],
  },
  dialysis: {
    answer: {
      en: "Bring any dialysis supplies you have, and tell the shelter staff you need dialysis.",
      es: "Traiga el material de diálisis que tenga, y dígale al personal del refugio que necesita diálisis.",
    },
    questions: ["What do I do about my dialysis?", "I need dialysis, what should I do?", "Should I bring my dialysis supplies?"],
  },
  documents: {
    answer: {
      en: "Bring your ID, insurance cards and phone charger if they're close at hand. Don't go looking for anything.",
      es: "Traiga su identificación, tarjetas del seguro y el cargador del teléfono si los tiene a mano. No se ponga a buscar nada.",
    },
    questions: ["Do I need to bring my ID?", "Should I bring my papers?", "Should I bring my insurance card?", "Do I need my driver's license?"],
  },
  shelter_supplies: {
    answer: {
      en: "The shelter has cots, water, meals, and outlets for medical devices.",
      es: "El refugio tiene catres, agua, comida, y enchufes para aparatos médicos.",
    },
    questions: ["Will there be food at the shelter?", "Is there a bed at the shelter?", "Can I plug in my medical machine at the shelter?", "What does the shelter have?"],
  },
  cost: {
    answer: {
      en: "The ride is free. Nobody asks you to pay.",
      es: "El transporte es gratis. Nadie le cobra nada.",
    },
    questions: ["How much does the ride cost?", "Do I have to pay for the ride?", "Is the ride free?", "I can't afford a ride."],
  },
  // Firefighters at Palo Alto Station 6 (Oct 24): under time pressure, state the risk and tell people
  // to leave; never send an untrained person back toward the fire, and never say "leave her".
  go_back_inside: {
    answer: {
      en: "Don't go back inside, not for a pet or for anything else. Get yourself out now.",
      es: "No regrese adentro, ni por una mascota ni por nada. Salga usted de inmediato.",
    },
    questions: ["Can I go back in for my cat?", "Can I go back inside for my dog?", "Should I run back in for my pills?", "Can I go back in the house to get my things?", "Can I return home for my wallet?"],
    safetyFor: "toward_danger",
  },
  go_get_someone: {
    answer: {
      en: "Don't go back for them. Get yourself out now. If you tell me their address, I'll pass it to the dispatcher.",
      es: "No regrese por esa persona. Salga usted de inmediato. Si me dice dónde vive, se lo paso al despachador.",
    },
    questions: ["Should I go get my neighbor?", "Should I go back for my mother?", "Can I go pick up my friend down the street?", "Should I go check on the lady next door?", "Should I go get Susan down the road?"],
    safetyFor: "toward_danger",
  },
  medical_change: {
    answer: {
      en: "I can't give advice about medicine or oxygen. For trouble breathing, call 911.",
      es: "No puedo darle consejos sobre medicinas ni oxígeno. Si alguien tiene problemas para respirar, llame al 911.",
    },
    questions: ["Should I turn my oxygen up?", "How many pills should I take?", "Should I take an extra dose of my insulin?", "Can I use more oxygen because of the smoke?", "Should I double my heart medicine?"],
    safetyFor: "medical_change",
  },
  // For a resident trapped in the heat ("It's so hot in here. What do I do? I'm gonna die."). The
  // trapped steps are CAL FIRE's Ready, Set, Go! "If you
  // are trapped" section (newportbeachca.gov Go evacuation guide, CAL FIRE Go brochure); the heat
  // steps are Ready.gov/heat (a fan alone doesn't lower body temperature; confusion, dizziness or
  // hot dry skin is heat stroke); oxygen is the home-oxygen fire-safety handouts. Wet towels under
  // doors and a damp cloth over the face weren't verified (CDC: cloth doesn't stop smoke), so they
  // aren't said. A cooling center is left out: it conflicts with staying inside while trapped.
  // CAL FIRE's "so firefighters can see your house" read to the voice exam's judge as firefighters
  // being on their way while no one had accepted, so the lights line says why without naming anyone.
  trapped_by_fire: {
    answer: {
      en: "If fire blocks your way out, stay inside. Close every door and window, but leave the doors unlocked. Go to a room in the middle of the house, not against an outside wall. Fill the sinks and tub with water. Turn on your lights, so the house can be seen through the smoke.",
      es: "Cuando el fuego le bloquea la salida, permanezca dentro de la casa. Cierre todas las puertas y ventanas, pero no les ponga llave. Vaya a un cuarto en el centro de la casa, lejos de las paredes de afuera. Llene los lavabos y la tina con agua. Prenda las luces, para que la casa se vea entre el humo.",
    },
    questions: ["What do I do, the fire is at my house?", "I'm trapped, what do I do?", "There are flames outside my door, what should I do?", "I can't get out because of the fire, what do I do?", "The house is on fire, what do I do?", "Should I stay inside, the fire is at the door?"],
    safetyFor: "fire_at_home",
  },
  smoke_inside: {
    answer: {
      en: "If smoke is coming in and the way out is clear, leave now. If you can't get out, close every door and window, and get low, under the smoke, where the air is cleaner. If you have an N ninety-five mask, put it on.",
      es: "Cuando entra humo y la salida está libre, salga ya. Si no puede salir, cierre todas las puertas y ventanas, y agáchese, por debajo del humo, donde el aire está más limpio. Si tiene una mascarilla N noventa y cinco, póngasela.",
    },
    questions: ["There's smoke in the house, what do I do?", "I can't breathe from the smoke, what should I do?", "Smoke is coming in, what do I do?", "The room is full of smoke, what do I do?"],
    safetyFor: "fire_at_home",
  },
  heat_inside: {
    answer: {
      en: "Heat inside can mean the fire is close. If the way out is clear, leave now. If you can't get out, close every door and window, drink water, and cool off with wet cloths. If you feel confused or dizzy, tell me now.",
      es: "El calor adentro puede significar que el fuego está cerca. Si la salida está libre, salga ya. Si no puede salir, cierre todas las puertas y ventanas, tome agua y refrésquese con trapos mojados. Si se siente confundido o mareado, dígamelo de inmediato.",
    },
    questions: ["It's so hot in here, what do I do?", "It's getting really hot, what should I do?", "I'm burning up in here, what do I do?", "The heat is unbearable, what do I do?"],
    safetyFor: "fire_at_home",
  },
  oxygen_near_fire: {
    answer: {
      en: "Oxygen makes everything near it catch fire and burn much faster. Keep the tank and tubing clear of any flame, heat or sparks, and don't smoke.",
      es: "El oxígeno hace que todo lo que está cerca prenda y se queme mucho más rápido. Mantenga el tanque y la manguera lejos de cualquier llama, calor o chispa, y no fume.",
    },
    questions: ["I'm on oxygen and the fire is close, what do I do?", "Is my oxygen tank dangerous with the fire?", "Will my oxygen catch fire?", "There's smoke and I'm on oxygen, what do I do?"],
    safetyFor: "fire_at_home",
  },
};

export const APPROVED_ANSWER_IDS = Object.keys(APPROVED_ANSWERS) as ApprovedAnswerId[];

export type ApprovedMatch = { id: ApprovedAnswerId; score: number; lookupMs: number };

export const isApprovedAnswerId = (value: string | undefined): value is ApprovedAnswerId =>
  value !== undefined && value in APPROVED_ANSWERS;

export const bankText = (id: ApprovedAnswerId, language: string) =>
  language === "en" || language === "es" ? APPROVED_ANSWERS[id].answer[language] : undefined;

// Questions the ordinary answers may never meet, however close Moss scores them. "Can I go back in
// for my cat?" scored close to "Can I bring my cat?" and heard "Yes, bring your pets." on every
// call (unsafe advice set, Oct 24). Going back or going to get someone gets a safety answer,
// changing a dose or a setting gets the medical one, and staying or waiting gets none: the ride
// status line answers that. The policy question is Claude's English restatement, so one English
// list covers every call language.
const UNSAFE_QUESTIONS: Record<UnsafeKind, RegExp[]> = {
  toward_danger: [
    /\b(go|goes|going|went|run|running|head|heading|drive|driving|walk|walking|come|coming|turn|turning)\s+(right\s+)?back\b/,
    /\bback\s+(in|inside|into|for|to\s+(get|the|my|our|her|his|their))\b/,
    /\breturn(ing)?\b/,
    /\bgo\s+(and\s+)?(get|grab|find|look\s+for|pick\s+up|check\s+on)\b/,
  ],
  staying: [/\b(stay|staying|wait|waiting)\b(?!\s+with\b)/, /\b(shelter|hide|hiding)\s+in\s+place\b/],
  fire_at_home: [/\b(fire|flames?|smoke|smoky|burning|hot|heat|trapped|stuck|can'?t\s+(get\s+out|breathe))\b/],
  medical_change: [
    /\b(dose|doses|dosage)\b/,
    /\bhow\s+(many|much)\b.*\b(pills?|tablets?|medicines?|medications?|insulin|oxygen|puffs?)\b/,
    /\b(turn|set|put|crank)\b.*\b(up|down|higher|lower)\b/,
    /\b(more|extra|double|increase|decrease|higher|lower|less)\b.*\b(oxygen|flow|pills?|tablets?|medicines?|medications?|insulin|dose|heart)\b/,
  ],
};

const UNSAFE_KINDS = Object.keys(UNSAFE_QUESTIONS) as UnsafeKind[];

// Which kind wins when one question has two. Going back or changing a dose keeps its own safety
// answer ("can I go back in, it's burning?"). Fire at home beats staying: "should I stay inside, the
// fire's at the door?" needs the trapped steps, which say when staying inside is right.
const OUTRANKS: Partial<Record<UnsafeKind, UnsafeKind>> = { toward_danger: "fire_at_home", medical_change: "fire_at_home", fire_at_home: "staying" };

export function unsafeKindsOf(question: string): UnsafeKind[] {
  const text = question.toLowerCase();
  const kinds = UNSAFE_KINDS.filter((kind) => UNSAFE_QUESTIONS[kind].some((pattern) => pattern.test(text)));
  const outranked = new Set(kinds.map((kind) => OUTRANKS[kind]));
  return kinds.filter((kind) => !outranked.has(kind));
}

// A safe question may get only an ordinary answer. An unsafe one may get only the safety answer for
// what makes it unsafe, and only when that is all that does: "should I wait, or go back for her?"
// gets neither, because no single answer covers both.
export function mayGetApprovedAnswer(question: string, id: ApprovedAnswerId) {
  const kinds = unsafeKindsOf(question);
  const safetyFor = APPROVED_ANSWERS[id].safetyFor;
  if (kinds.length === 0) return safetyFor === undefined;
  return kinds.length === 1 && kinds[0] === safetyFor;
}

// The approved answer takes the place of Claude's reply only when Claude heard a policy question,
// code allows that answer for it, and the answer exists in the language the resident is speaking.
// Otherwise an ordinary question keeps Claude's own reply ("I don't know that."), and a dangerous
// one gets no reply at all: Claude's words there were the unsafe advice set's failures ("Stay where
// you are until help reaches you", "no vaya a buscarla todavía"), so only a safety answer is said.
export function withApprovedAnswer(heard: Interpretation, match: ApprovedMatch | null): Interpretation {
  if (heard.policyQuestion === "") return heard;
  const text = match && mayGetApprovedAnswer(heard.policyQuestion, match.id) ? bankText(match.id, heard.spokenLanguage) : undefined;
  if (match && text) return { ...heard, reply: text, asksWhatToDo: false, approvedAnswer: match };
  return unsafeKindsOf(heard.policyQuestion).length > 0 ? { ...heard, reply: "" } : heard;
}
