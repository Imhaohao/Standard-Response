"use client";

import { Car, Drop, FirstAidKit, PawPrint, Wind } from "@phosphor-icons/react";
import { FunctionArgs } from "convex/server";
import { useId } from "react";
import { api } from "@/convex/_generated/api";
import { ASSIST_LABELS, Assistance, MOBILITY_OPTIONS } from "@/components/ready/profile";
import { FIELD, OneOf, Question, Stepper, Toggle } from "./controls";

export type HouseRecord = FunctionArgs<typeof api.claims.claim>["record"];
type Medical = HouseRecord["medical"][number];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
] as const;

const CAN_LEAVE = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
] as const;

const MOBILITY = MOBILITY_OPTIONS.map(({ key, label, Icon }) => ({ value: key, label, Icon }));
const ASSISTANCE = (Object.keys(ASSIST_LABELS) as Assistance[]).map((key) => ({ value: key, label: ASSIST_LABELS[key] }));

const MEDICAL: { value: Medical; label: string; Icon: typeof Wind }[] = [
  { value: "oxygen", label: "Oxygen", Icon: Wind },
  { value: "dialysis", label: "Dialysis", Icon: Drop },
  { value: "other", label: "Other medical", Icon: FirstAidKit },
];

const MAX_PEOPLE = 12;

const withOrWithout = <T,>(list: T[], item: T, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((value) => value !== item));

// Who lives in the house the judge took, as the agent will hear it on the call. Everything is a tap
// except the name. Help getting out only matters for someone who can't walk out, so it waits until then.
export function HouseForm({ record, onChange }: { record: HouseRecord; onChange: (record: HouseRecord) => void }) {
  const id = useId();
  const set = (patch: Partial<HouseRecord>) => onChange({ ...record, ...patch });
  const walks = record.mobility === "walks";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-name`} className="type-small font-semibold text-ink-muted">
          Resident&apos;s name
        </label>
        <input id={`${id}-name`} className={FIELD} value={record.residentName} maxLength={60} autoComplete="off" onChange={(event) => set({ residentName: event.target.value })} />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <Question label="Language on the call">
          <OneOf options={LANGUAGES} value={record.language as "en" | "es"} onChange={(language) => set({ language })} />
        </Question>
        <Question label="People at home">
          <Stepper label="people at home" value={record.peopleCount} min={1} max={MAX_PEOPLE} onChange={(peopleCount) => set({ peopleCount })} />
        </Question>
      </div>
      <Question label="Can they leave on their own?">
        <OneOf options={CAN_LEAVE} value={record.canLeave} onChange={(canLeave) => set({ canLeave })} />
      </Question>
      <Question label="Getting around">
        <div className="grid grid-cols-3 gap-1.5">
          {MOBILITY.map(({ value, label, Icon }) => (
            <Toggle key={value} label={label} Icon={Icon} on={record.mobility === value} onChange={() => set({ mobility: value, ...(value === "walks" ? { assistanceRequired: "none" } : {}) })} />
          ))}
        </div>
      </Question>
      {!walks && (
        <Question label="Help getting out of the house">
          <OneOf options={ASSISTANCE} value={record.assistanceRequired} onChange={(assistanceRequired) => set({ assistanceRequired })} />
        </Question>
      )}
      <Question label="Anything else">
        <div className="flex flex-wrap gap-1.5">
          {MEDICAL.map(({ value, label, Icon }) => (
            <Toggle key={value} label={label} Icon={Icon} on={record.medical.includes(value)} onChange={(on) => set({ medical: withOrWithout(record.medical, value, on) })} />
          ))}
          <Toggle label="Pets" Icon={PawPrint} on={record.pets} onChange={(pets) => set({ pets })} />
          <Toggle label="Has a car" Icon={Car} on={record.hasCar} onChange={(hasCar) => set({ hasCar })} />
        </div>
      </Question>
    </div>
  );
}
