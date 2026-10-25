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
  | "medical_change";

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
type UnsafeKind = "toward_danger" | "staying" | "medical_change";

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
};

export const APPROVED_ANSWER_IDS = Object.keys(APPROVED_ANSWERS) as ApprovedAnswerId[];

export type ApprovedMatch = { id: ApprovedAnswerId; score: number; lookupMs: number };

export const isApprovedAnswerId = (value: string | undefined): value is ApprovedAnswerId =>
  value !== undefined && value in APPROVED_ANSWERS;

const bankText = (id: ApprovedAnswerId, language: string) =>
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
  medical_change: [
    /\b(dose|doses|dosage)\b/,
    /\bhow\s+(many|much)\b.*\b(pills?|tablets?|medicines?|medications?|insulin|oxygen|puffs?)\b/,
    /\b(turn|set|put|crank)\b.*\b(up|down|higher|lower)\b/,
    /\b(more|extra|double|increase|decrease|higher|lower|less)\b.*\b(oxygen|flow|pills?|tablets?|medicines?|medications?|insulin|dose|heart)\b/,
  ],
};

const UNSAFE_KINDS = Object.keys(UNSAFE_QUESTIONS) as UnsafeKind[];

export function unsafeKindsOf(question: string): UnsafeKind[] {
  const text = question.toLowerCase();
  return UNSAFE_KINDS.filter((kind) => UNSAFE_QUESTIONS[kind].some((pattern) => pattern.test(text)));
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
