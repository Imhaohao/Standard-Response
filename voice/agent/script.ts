import type { Doc } from "../../convex/_generated/dataModel";
import type { AssignedDriver } from "../../convex/voice";
import type { AgentRecord } from "./record";
import type { Lines, VehicleKind } from "./lines/types";
import { EN } from "./lines/en";
import { ES } from "./lines/es";
import { ZH } from "./lines/zh";
import { KO } from "./lines/ko";
import { VI } from "./lines/vi";
import { TL } from "./lines/tl";
import { RU } from "./lines/ru";
import { JA } from "./lines/ja";
import type { Language } from "../../convex/languages";
import { currentHazard } from "../hazard";

// Everything the agent may say that isn't Claude's short acknowledgment. Status lines are fixed
// templates: Claude never writes an ETA, a driver's name, or a promise.

export type { Language } from "../../convex/languages";
export { languageOf } from "../../convex/languages";
export type RequestStatus = Doc<"requests">["status"];

export const LINES: Record<Language, Lines> = { en: EN, es: ES, zh: ZH, ko: KO, vi: VI, tl: TL, ru: RU, ja: JA };

// Ends a line that leaves the resident waiting with what to do if the hazard reaches them first.
export function withSafety(line: string, language: Language) {
  const lines = LINES[language];
  return `${line}${lines.sentenceGap ?? " "}${lines.safety[currentHazard()]}`;
}

function readbackParts(record: AgentRecord, lines: Lines) {
  const leaving = record.canLeave === "yes" && record.hasCar !== false && !record.mobility;
  return [
    leaving ? lines.leavingOnOwn : undefined,
    leaving && record.hasCar ? lines.byCar : undefined,
    record.peopleCount !== undefined ? lines.people(record.peopleCount) : undefined,
    record.mobility ? lines.mobility[record.mobility] : undefined,
    record.medical?.includes("oxygen") ? lines.oxygen : undefined,
    record.assistanceRequired && record.assistanceRequired !== "none" ? lines.assistance[record.assistanceRequired] : undefined,
    record.pets ? lines.pets : undefined,
    record.hasCar === false ? lines.noCar : undefined,
    record.address ? lines.atAddress(record.address) : undefined,
  ].filter((part): part is string => part !== undefined);
}

// The facts one answer just gave, said back from templates: "2 people, with pets." It can't
// overstate anything, so it is spoken in every language, unlike Claude's own acknowledgment.
type EchoPart = (changed: AgentRecord, lines: Lines) => string | undefined;

// Whole clauses ("you can't leave on your own") are a sentence each; the short household facts
// share one ("2 people, with pets."), so the echo never crams a clause into a list.
const ECHO_CLAUSES: EchoPart[] = [
  (changed, lines) => (changed.canLeave ? lines.leaveEcho[changed.canLeave] : undefined),
  (changed, lines) => (changed.hasCar === true ? lines.hasCarEcho : undefined),
];
const ECHO_FACTS: EchoPart[] = [
  (changed, lines) => (changed.peopleCount !== undefined ? lines.people(changed.peopleCount) : undefined),
  (changed, lines) => (changed.mobility ? lines.mobility[changed.mobility] : undefined),
  (changed, lines) => (changed.medical?.includes("oxygen") ? lines.oxygen : undefined),
  (changed, lines) => (changed.assistanceRequired ? lines.assistance[changed.assistanceRequired] : undefined),
  (changed, lines) => (changed.pets ? lines.pets : undefined),
  (changed, lines) => (changed.hasCar === false ? lines.noCar : undefined),
];

const said = (parts: EchoPart[], changed: AgentRecord, lines: Lines) =>
  parts.map((part) => part(changed, lines)).filter((part): part is string => part !== undefined);

const sentence = (text: string, lines: Lines) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${lines.sentenceEnd ?? "."}`;

export function echo(changed: AgentRecord, language: Language) {
  const lines = LINES[language];
  const facts = said(ECHO_FACTS, changed, lines);
  const sentences = [...said(ECHO_CLAUSES, changed, lines), ...(facts.length ? [facts.join(lines.listSeparator)] : [])];
  return sentences.map((text) => sentence(text, lines)).join(lines.sentenceGap ?? " ");
}

export function readback(record: AgentRecord, language: Language) {
  const lines = LINES[language];
  const summary = readbackParts(record, lines).join(lines.listSeparator);
  return `${lines.readbackIntro} ${summary.charAt(0).toUpperCase()}${summary.slice(1)}${lines.sentenceEnd ?? "."} ${lines.readbackQuestion}`;
}

// What the resident is told about their ride, by request status. The table in PLAN.md
// "Request status and what the agent may say" is the source; change both together.

function vehicleKind(driver: AssignedDriver): VehicleKind {
  if (driver.stretcherSpaces > 0 && driver.vehicleType !== "ambulance") return "stretcher_van";
  if (driver.wheelchairSpaces > 0 && driver.vehicleType === "paratransit") return "wheelchair_van";
  return driver.vehicleType;
}

const etaWords = (driver: AssignedDriver, lines: Lines) => lines.minutes(Math.max(1, Math.round(driver.etaMinutes)));

function acceptedLine(driver: AssignedDriver, lines: Lines) {
  const crew = driver.crewSize < 2 ? "" : lines.crew(driver.crewSize);
  return lines.accepted(lines.vehicle[vehicleKind(driver)], crew, etaWords(driver, lines), driver.name);
}

export type RideStatus = { status: RequestStatus; driver: AssignedDriver | null } | null;

// The only sentence the agent may say about a ride. `null` means there's no ride request.
export function statusLine(ride: RideStatus, language: Language): string | null {
  if (!ride) return null;
  const lines = LINES[language];
  const { status, driver } = ride;
  if (status === "reassigning") return withSafety(lines.reassigning, language);
  if (status === "arrived" || status === "closed") return lines.arrived(driver?.shelterName);
  if (!driver || status === "received" || status === "approved") return withSafety(lines.waiting, language);
  return status === "en_route" ? lines.enRoute(driver.name, etaWords(driver, lines)) : acceptedLine(driver, lines);
}
