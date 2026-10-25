import type { Answer } from "./interpreter";
import type { AgentRecord } from "./record";
import type { Language } from "./script";

// Plain answers to the agent's own questions, read without Claude. Each question has a small answer
// space ("Just me.", "I use a walker.", "No, I don't have a car.", "One person to help."), so a
// whole-utterance pattern can read the common forms exactly. A pattern must match everything said:
// any extra detail, emotion, emergency or question leaves the turn to Claude. The patterns were
// written from the answer space and checked against the persona phrasings
// (modeling/rollcall_d/resident.py), not from the voice exam's calls.

export type Parsed = { updates: AgentRecord; answer?: Answer; saysChairKind?: boolean };
type Pattern = { match: RegExp; read: (groups: Record<string, string | undefined>) => Parsed };

const COUNTS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};
const countOf = (word: string) => COUNTS[word] ?? Number.parseInt(word, 10);

const ALONE = /^(just me|it's just me|only me|me|me alone|just myself|solo yo|sólo yo|nada más yo|yo sola|yo solo)$/;
const PAIR = /^me and my \w+$/;
const PETS_NONE = /^(no pets|sin mascotas)$/;

// "Two of us, and the dog." / "Somos tres. Sin mascotas." The head count, then pets if said.
function household(groups: Record<string, string | undefined>): Parsed {
  const who = groups.who ?? "";
  const counted = groups.count ? countOf(groups.count) : undefined;
  const people = ALONE.test(who) ? 1 : PAIR.test(who) ? 2 : counted;
  const updates: AgentRecord = people !== undefined && Number.isFinite(people) ? { peopleCount: people } : {};
  if (groups.pets) updates.pets = !PETS_NONE.test(groups.pets);
  return { updates };
}

const mobilityFrom = (aid: string): AgentRecord["mobility"] => {
  if (/walker|andadera/.test(aid)) return "walker";
  if (/power|electric|motorized|eléctrica|electrica/.test(aid)) return "power_wheelchair";
  if (/wheelchair|silla de ruedas/.test(aid)) return "manual_wheelchair";
  return "bedbound";
};

const needs = (groups: Record<string, string | undefined>): Parsed => {
  const aid = groups.aid ?? "";
  const updates: AgentRecord = { mobility: mobilityFrom(aid) };
  if (groups.oxygen) updates.medical = /^(no|sin)/.test(groups.oxygen) ? [] : ["oxygen"];
  return { updates, saysChairKind: /manual|power|electric|motorized|eléctrica|electrica/.test(aid) };
};

const set = (updates: AgentRecord, answer?: Answer) => () => ({ updates, answer });

const PERSON_EN = "(?:i|he|she|my (?:husband|wife|son|daughter|mom|mother|dad|father|sister|brother|partner|grandson|granddaughter|grandmother|grandfather))";
const PERSON_ES = "(?:(?:mi (?:esposo|esposa|hijo|hija|mamá|mama|madre|papá|papa|padre|hermano|hermana|abuelo|abuela) )?)";
const PETS_EN = "(?<pets>no pets|(?:my|our|a|the) (?:dog|dogs|cat|cats|pets))";
const PETS_ES = "(?<pets>sin mascotas|(?:mi|nuestro|el|un) (?:perro|gato)|(?:mis|nuestros) (?:perros|gatos))";
const OXYGEN_EN = "(?: (?:and )?(?<oxygen>no oxygen|(?:i'm|he's|she's) on oxygen))?";
const OXYGEN_ES = "(?: (?:y )?(?<oxygen>no uso oxígeno|sin oxígeno|uso oxígeno))?";

const EN: Record<string, Pattern[]> = {
  can_leave: [
    { match: /^(?:yes |yeah )?(?:i|we) can(?: all)?(?: get out| leave| walk out| go| walk)?(?: on (?:my|our) own)?$/, read: set({ canLeave: "yes" }, "yes") },
    { match: /^(?:no |nope )?(?:i|we) (?:can't|cannot|can not)(?: get out| leave| go| walk out)?(?: on (?:my|our) own| by (?:myself|ourselves)| alone)?$/, read: set({ canLeave: "no" }, "no") },
    { match: /^(?:i don't know|i'm not sure)(?: i'm not sure how (?:i|we)'d get out)?$/, read: set({ canLeave: "unsure" }, "unclear") },
  ],
  has_car: [
    { match: /^(?:yes )?(?:(?:i|we) (?:have|got) a car(?: here)?|there's a car(?: here)?(?: (?:i|we) can use)?|(?:my|our) car's (?:here|in the driveway))$/, read: set({ hasCar: true }, "yes") },
    { match: /^(?:no )?(?:(?:i|we) (?:don't|do not) have a car|no car|(?:i|we) don't drive(?: anymore)?)$/, read: set({ hasCar: false }, "no") },
  ],
  household: [
    { match: new RegExp(`^(?:it's |there's |there are |we're |we are )?(?:(?<who>just me|only me|me alone|just myself|me and my \\w+)|(?<count>two|three|four|five|six|seven|eight|nine|ten|\\d+)(?: of us| people))(?: (?:and |with )?${PETS_EN})?$`), read: household },
  ],
  needs: [
    { match: new RegExp(`^(?:yes )?${PERSON_EN} (?:uses?|use) (?:a |my |his |her )?(?<aid>walker|(?:manual |power |electric |motorized )?wheelchair)${OXYGEN_EN}$`), read: needs },
    { match: new RegExp(`^(?:yes )?(?:i'm|i am|he's|she's) in (?:a|my|his|her) (?<aid>(?:power |electric )?wheelchair)${OXYGEN_EN}$`), read: needs },
    { match: new RegExp(`^(?:yes )?${PERSON_EN} (?:can't|cannot) get out of (?<aid>bed)${OXYGEN_EN}$`), read: needs },
    { match: /^no(?: we| i)? (?:can (?:all |both )?walk|everyone can walk|we can all walk)$/, read: set({ mobility: "walks" }, "no") },
  ],
  assistance: [
    { match: /^(?:just )?one person(?: to help| helping)?(?: me| him| her| us)?$/, read: set({ assistanceRequired: "one_person_assist" }) },
    { match: /^(?:it takes )?two people(?: to lift)?(?: me| him| her)?$/, read: set({ assistanceRequired: "two_person_lift" }) },
    { match: /^(?:none|no help(?: needed)?(?: we can manage)?|we can manage|i can manage)$/, read: set({ assistanceRequired: "none" }, "no") },
  ],
  neighbor: [{ match: /^no(?: i don't think so| one| nobody| not that i know)?$/, read: set({}, "no") }],
};

const ES: Record<string, Pattern[]> = {
  can_leave: [
    { match: /^(?:sí |si )?(?:puedo|podemos) salir(?: por (?:mi|nuestra) cuenta)?$/, read: set({ canLeave: "yes" }, "yes") },
    { match: /^no(?: no)? (?:puedo|podemos) salir(?: sol[oa]s?| por (?:mi|nuestra) cuenta)?$/, read: set({ canLeave: "no" }, "no") },
    { match: /^no sé(?: no sé cómo saldría)?$/, read: set({ canLeave: "unsure" }, "unclear") },
  ],
  has_car: [
    { match: /^(?:sí |si )?(?:tengo carro|tenemos carro|hay un carro aquí(?: que (?:puedo|podemos) usar)?)$/, read: set({ hasCar: true }, "yes") },
    { match: /^no(?: no)? (?:tengo|tenemos) carro$/, read: set({ hasCar: false }, "no") },
  ],
  household: [
    { match: new RegExp(`^(?:(?<who>solo yo|sólo yo|nada más yo|yo sola|yo solo)|somos (?<count>dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\\d+))(?: (?:y )?${PETS_ES})?$`), read: household },
  ],
  needs: [
    { match: new RegExp(`^(?:sí )?(?:${PERSON_ES}usa|uso) (?<aid>andadera|silla de ruedas(?: eléctrica| electrica)?)${OXYGEN_ES}$`), read: needs },
    { match: new RegExp(`^(?:sí )?${PERSON_ES}no (?:se |me )?(?:puede|puedo) levantar de la (?<aid>cama)${OXYGEN_ES}$`), read: needs },
    { match: /^no(?: todos)? (?:podemos|puedo) caminar$/, read: set({ mobility: "walks" }, "no") },
  ],
  assistance: [
    { match: /^una persona que (?:me |le |nos )?ayude$/, read: set({ assistanceRequired: "one_person_assist" }) },
    { match: /^se necesitan dos personas para levantar(?:lo|la|me)?$/, read: set({ assistanceRequired: "two_person_lift" }) },
    { match: /^no (?:necesito|necesitamos) ayuda$/, read: set({ assistanceRequired: "none" }, "no") },
  ],
  neighbor: [{ match: /^no(?: creo que no| nadie)?$/, read: set({}, "no") }],
};

const PATTERNS: Partial<Record<Language, Record<string, Pattern[]>>> = { en: EN, es: ES };

// The fields a plain answer gives at this step, or null when it isn't a plain answer.
export function plainAnswer(said: string, step: string, language: Language): Parsed | null {
  for (const pattern of PATTERNS[language]?.[step] ?? []) {
    const match = said.match(pattern.match);
    if (match) return pattern.read(match.groups ?? {});
  }
  return null;
}
