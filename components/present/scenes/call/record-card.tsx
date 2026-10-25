"use client";

import { motion } from "motion/react";
import { sceneMove } from "../../motion";
import type { RecordField } from "./roseland-call";

function FieldValue({ field, seconds }: { field: RecordField; seconds: number }) {
  const filled = Boolean(field.value) && field.atSeconds <= seconds;
  if (!field.value) return <span className="hatch mt-3 block h-9 w-40 rounded-lg text-on-night-muted opacity-25" aria-label="Not filled in yet" />;
  return (
    <motion.span
      className="type-deck-lede mt-1 block font-semibold"
      initial={false}
      animate={filled ? { opacity: 1, x: 0 } : { opacity: 0, x: -16 }}
      transition={sceneMove}
    >
      {field.value}
    </motion.span>
  );
}

// The household record the call fills in, one field at a time as Roseland answers.
export function RecordCard({ fields, seconds }: { fields: RecordField[]; seconds: number }) {
  return (
    <dl className="flex flex-col gap-10 rounded-[40px] bg-night-raised p-10 shadow-[0_30px_80px_oklch(0_0_0/0.45)]">
      {fields.map((field) => (
        <div key={field.label}>
          <dt className="type-deck-note text-on-night-muted">{field.label}</dt>
          <dd>
            <FieldValue field={field} seconds={seconds} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
