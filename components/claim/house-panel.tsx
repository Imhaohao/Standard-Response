"use client";

import { X } from "@phosphor-icons/react";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { failureText } from "./controls";
import { HouseForm, HouseRecord } from "./house-form";

type Claimed = { address: string; residentName: string };

// Step three: the picked house's resident, ready to edit, and the button that takes the house.
// Taking it checks again on the server, so a house another judge got first says so here.
export function HousePanel({
  code,
  householdId,
  address,
  record,
  stillOpen,
  onChange,
  onClose,
  onClaimed,
}: {
  code: string;
  householdId: Id<"households">;
  address: string;
  record: HouseRecord | null;
  stillOpen: boolean;
  onChange: (record: HouseRecord) => void;
  onClose: () => void;
  onClaimed: (claimed: Claimed) => void;
}) {
  const claim = useMutation(api.claims.claim);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function take() {
    if (!record) return;
    setSaving(true);
    setError(null);
    try {
      const { address: taken } = await claim({ code, householdId, record });
      onClaimed({ address: taken, residentName: record.residentName.trim() });
    } catch (failure) {
      setError(failureText(failure, "Couldn't take the house. Try again."));
      setSaving(false);
    }
  }

  const refusal = stillOpen ? error : "Another judge just took this house. Pick another.";
  return (
    <section aria-labelledby="house-heading" className="card pointer-events-auto flex max-h-full w-[28rem] max-w-full flex-col">
      <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <h2 id="house-heading" className="type-title">
            {address}
          </h2>
          <p className="type-small mt-1 text-on-panel-muted">Who lives here? Our agent will ask you on the call.</p>
        </div>
        <Button variant="onPanelQuiet" size="md" square aria-label="Close this house" onClick={onClose}>
          <X weight="bold" className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{record ? <HouseForm record={record} onChange={onChange} /> : <FormSkeleton />}</div>
      <footer className="flex flex-col gap-2 border-t border-line px-5 py-4">
        {refusal && (
          <p role="alert" className="type-small font-semibold text-signal">
            {refusal}
          </p>
        )}
        <Button size="lg" onClick={take} disabled={!record || saving || !stillOpen || record.residentName.trim() === ""} className="w-full">
          {saving ? "Taking the house…" : "Take this house"}
        </Button>
      </footer>
    </section>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      {[48, 44, 44, 96, 44].map((height, index) => (
        <div key={index} className="flex flex-col gap-2">
          <div className="h-4 w-32 rounded bg-surface-sunk" />
          <div className="animate-pulse rounded-xl bg-surface-sunk" style={{ height }} />
        </div>
      ))}
    </div>
  );
}
