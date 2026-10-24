import type { Interpretation } from "./interpreter";
import type { Language } from "./script";

// Answers the agency has approved for questions residents ask mid-call ("Can my dog come?").
// Moss (answerLookup.ts) only picks which one fits; the words spoken are always these, never
// Claude's. Every answer is fictional agency policy for the demo, and each one passes the honesty
// guard (approvedAnswers.test.ts), so none of them can sound like a promise of a ride.

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
  | "cost";

type BankLanguage = Extract<Language, "en" | "es">;

type ApprovedAnswer = {
  answer: Record<BankLanguage, string>;
  // Ways a resident asks it, in English. Claude restates every policy question in English
  // (Interpretation.policyQuestion), so these match a question asked in any call language.
  questions: string[];
};

export const APPROVED_ANSWERS: Record<ApprovedAnswerId, ApprovedAnswer> = {
  pets: {
    answer: {
      en: "Yes, bring your pets. Keep dogs on a leash, and cats in a carrier if you have one.",
      es: "Sí, traiga a sus mascotas. Los perros con correa, y los gatos en un transportador si tiene uno.",
    },
    questions: ["Can I bring my dog?", "Can I bring my cat?", "Can my pets come with me?", "What do I do with my pets?", "Can I take my bird?", "Is my service dog allowed?"],
  },
  oxygen: {
    answer: {
      en: "Yes, bring the oxygen, any spare tanks, and the charger if it's a concentrator.",
      es: "Sí, traiga el oxígeno, los tanques de repuesto, y el cargador si es un concentrador.",
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
      en: "Yes, the wheelchair comes with you, powered chairs too.",
      es: "Sí, la silla de ruedas va con usted, también las eléctricas.",
    },
    questions: ["Can I bring my wheelchair?", "Will a power wheelchair fit?", "Is there room for an electric wheelchair?", "Do I have to leave my wheelchair behind?"],
  },
  walker: {
    answer: {
      en: "Yes, bring the walker or cane. There's room for it.",
      es: "Sí, traiga la andadera o el bastón. Hay lugar para eso.",
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
      en: "Yes, a caregiver or family member can ride with you.",
      es: "Sí, un cuidador o un familiar puede ir con usted.",
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
};

export const APPROVED_ANSWER_IDS = Object.keys(APPROVED_ANSWERS) as ApprovedAnswerId[];

export type ApprovedMatch = { id: ApprovedAnswerId; score: number; lookupMs: number };

export const isApprovedAnswerId = (value: string | undefined): value is ApprovedAnswerId =>
  value !== undefined && value in APPROVED_ANSWERS;

const bankText = (id: ApprovedAnswerId, language: string) =>
  language === "en" || language === "es" ? APPROVED_ANSWERS[id].answer[language] : undefined;

// The approved answer takes the place of Claude's reply only when Claude heard a policy question
// and the answer exists in the language the resident is speaking. Otherwise Claude's own reply
// ("I don't know that.") stands.
export function withApprovedAnswer(heard: Interpretation, match: ApprovedMatch | null): Interpretation {
  if (heard.policyQuestion === "" || !match) return heard;
  const text = bankText(match.id, heard.spokenLanguage);
  if (!text) return heard;
  return { ...heard, reply: text, asksWhatToDo: false, approvedAnswer: match };
}
