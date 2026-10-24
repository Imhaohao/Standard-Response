// The preparedness survey: what a household can tell about itself, kept on its own phone.
//
// This is the readiness add-on, separate from the evacuation night. Households answer before any
// disaster, about the things that decide how a disaster goes for them and that they would rather
// not hand over: whether their tap water is safe, whether they could afford to leave, whether
// someone at home depends on power. Answers never leave the phone. What leaves is a noised share
// of a count (tally.ts) and a noised change to a shared model (tasks.ts), always mixed with other
// households' before the county sees it (node.ts).

export type Topic = "water" | "money" | "health";
export const TOPICS: Topic[] = ["water", "money", "health"];

export const TOPIC_LABELS: Record<Topic, { title: string; why: string }> = {
  water: {
    title: "Water at home",
    why: "After the Eaton fire, damaged pipes let benzene and other chemicals into Altadena's tap water. Knowing which homes are at risk tells the county where to send test kits and filters first.",
  },
  money: {
    title: "Money for an evacuation",
    why: "Many people stay because leaving costs money they don't have. Knowing how many can't pay for a week away tells the county how many motel vouchers and gas cards to have ready.",
  },
  health: {
    title: "Power and medicine",
    why: "Oxygen, dialysis and cold medicine fail when the power goes out. Knowing how many homes depend on them, area by area, tells the county where to put generators and charging points.",
  },
};

export type Option = { value: string; label: string };
export type Question = { id: QuestionId; topic: Topic; prompt: string; options: Option[] };

export const QUESTIONS = [
  {
    id: "waterSource",
    topic: "water",
    prompt: "Where does your tap water come from?",
    options: [
      { value: "utility", label: "A water company" },
      { value: "well", label: "A private well" },
      { value: "unknown", label: "Not sure" },
    ],
  },
  {
    id: "homeBuilt",
    topic: "water",
    prompt: "When was your home built?",
    options: [
      { value: "before1950", label: "Before 1950" },
      { value: "1950to1985", label: "1950 to 1985" },
      { value: "after1986", label: "1986 or later" },
      { value: "unknown", label: "Not sure" },
    ],
  },
  {
    id: "servicePipe",
    topic: "water",
    prompt: "What is the pipe from the street to your home made of?",
    options: [
      { value: "lead", label: "Lead or galvanized steel" },
      { value: "safe", label: "Copper or plastic" },
      { value: "unknown", label: "Not sure" },
    ],
  },
  {
    id: "fireNearby",
    topic: "water",
    prompt: "Was a building on your block damaged by fire in the last two years?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "waterChanged",
    topic: "water",
    prompt: "In the last month, has your tap water looked, smelled or tasted different?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "waterTest",
    topic: "water",
    prompt: "Has a home kit or a lab tested your tap water?",
    options: [
      { value: "failed", label: "Yes, something was above the safe level" },
      { value: "passed", label: "Yes, it was fine" },
      { value: "untested", label: "No" },
    ],
  },
  {
    id: "storedWater",
    topic: "water",
    prompt: "Do you keep three days of drinking water at home?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "income",
    topic: "money",
    prompt: "Roughly what does your household earn in a year?",
    options: [
      { value: "under35", label: "Under $35,000" },
      { value: "35to75", label: "$35,000 to $75,000" },
      { value: "75to150", label: "$75,000 to $150,000" },
      { value: "over150", label: "Over $150,000" },
    ],
  },
  {
    id: "tenure",
    topic: "money",
    prompt: "Do you rent or own your home?",
    options: [
      { value: "rent", label: "Rent" },
      { value: "own", label: "Own" },
    ],
  },
  {
    id: "vehicles",
    topic: "money",
    prompt: "How many working cars does your household have?",
    options: [
      { value: "0", label: "None" },
      { value: "1", label: "One" },
      { value: "2", label: "Two or more" },
    ],
  },
  {
    id: "insurance",
    topic: "money",
    prompt: "Would your insurance pay for somewhere to stay if you had to leave?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "unknown", label: "Not sure" },
    ],
  },
  {
    id: "hourlyWork",
    topic: "money",
    prompt: "Does anyone lose pay when they miss work, because they're paid by the hour or by the job?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "householdSize",
    topic: "money",
    prompt: "How many people live in your home?",
    options: [
      { value: "1", label: "Just me" },
      { value: "2", label: "Two" },
      { value: "3", label: "Three or four" },
      { value: "5", label: "Five or more" },
    ],
  },
  {
    id: "weekAway",
    topic: "money",
    prompt: "Could you pay for a week away from home, about $1,500 for gas, a motel and food, without borrowing?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "poweredDevice",
    topic: "health",
    prompt: "Does anyone at home need power for a medical device, such as oxygen, a CPAP, dialysis or a power wheelchair?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "coldMedicine",
    topic: "health",
    prompt: "Does anyone take medicine that has to stay cold, such as insulin?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
] as const satisfies readonly { id: string; topic: Topic; prompt: string; options: readonly Option[] }[];

export type QuestionId = (typeof QUESTIONS)[number]["id"];
export type Answers = Partial<Record<QuestionId, string>>;

export const QUESTION_BY_ID = new Map<string, (typeof QUESTIONS)[number]>(QUESTIONS.map((q) => [q.id, q]));

export const questionsFor = (topic: Topic) => QUESTIONS.filter((q) => q.topic === topic);

// Keeps only answers to known questions with one of their own options.
export function cleanAnswers(value: unknown): Answers {
  if (typeof value !== "object" || value === null) return {};
  const answers: Answers = {};
  for (const [id, answer] of Object.entries(value)) {
    const question = QUESTION_BY_ID.get(id);
    if (question && typeof answer === "string" && question.options.some((o) => o.value === answer)) answers[question.id] = answer;
  }
  return answers;
}

export const answeredCount = (answers: Answers, topic: Topic) => questionsFor(topic).filter((q) => answers[q.id] !== undefined).length;
