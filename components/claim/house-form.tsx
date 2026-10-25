"use client";

import { FunctionArgs } from "convex/server";
import { useId } from "react";
import { api } from "@/convex/_generated/api";
import { FIELD, OneOf, Question } from "./controls";

export type HouseRecord = FunctionArgs<typeof api.claims.claim>["record"];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
] as const;

// The demo role comes from registration order. Name and language stay editable,
// while the role stays consistent with the server assignment.
export function HouseForm({ record, onChange }: { record: HouseRecord; onChange: (record: HouseRecord) => void }) {
  const id = useId();
  const set = (patch: Partial<HouseRecord>) => onChange({ ...record, ...patch });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-name`} className="type-small font-semibold text-ink-muted">
          Resident&apos;s name
        </label>
        <input id={`${id}-name`} className={FIELD} value={record.residentName} maxLength={60} autoComplete="off" onChange={(event) => set({ residentName: event.target.value })} />
      </div>
      <Question label="Demo role">
        <p className="type-body text-ink">
          {record.hasCar ? "Has a van, can leave independently and can help a neighbor." : "Bedridden, cannot leave independently and needs one person to help."}
        </p>
        <p className="type-small text-ink-muted">One person lives here. Helpers must agree before a pickup is confirmed.</p>
      </Question>
      <Question label="Language on the call">
        <OneOf options={LANGUAGES} value={record.language as "en" | "es"} onChange={(language) => set({ language })} />
      </Question>
    </div>
  );
}
