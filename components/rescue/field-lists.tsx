"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatClock } from "@/lib/time";
import { Section } from "../ui/section";

export function DoorCheckQueue() {
  const homes = useQuery(api.doorChecks.queue, { limit: 12 });
  return (
    <Section title="Door checks, in order">
      {homes?.length === 0 ? (
        <p className="type-small px-4 py-4 text-ink-muted">Homes nobody reached by phone or text land here.</p>
      ) : (
        <ol className="type-small flex flex-col">
          {homes?.map((home, i) => (
            <li key={home._id} className="flex justify-between gap-2 border-b border-line px-4 py-2">
              <span>
                {i + 1}. {home.address}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

export function Nominations() {
  const nominations = useQuery(api.nominations.open);
  if (!nominations?.length) return null;
  return (
    <Section title="Neighbors named on calls">
      <ul className="type-small flex flex-col">
        {nominations.map((n) => (
          <li key={n._id} className="flex justify-between gap-2 border-b border-line px-4 py-2">
            <span>{n.spokenAddress}</span>
            <span className="text-ink-muted">{formatClock(n.at)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
