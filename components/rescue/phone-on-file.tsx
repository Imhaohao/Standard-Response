"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { FormEvent, useState } from "react";
import { Phone } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ON_PANEL_FIELD } from "@/components/ui/field";
import { phoneForPeople } from "@/lib/labels";

type Home = { _id: Id<"households">; callbackNumber: string; residentName?: string; simulated: boolean };


function NumberForm({ home, onDone }: { home: Home; onDone: () => void }) {
  const setPhone = useMutation(api.riders.setPhone);
  const [name, setName] = useState(home.residentName ?? "");
  const [phone, setPhoneInput] = useState(home.simulated ? "" : phoneForPeople(home.callbackNumber));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await setPhone({ householdId: home._id, phone, residentName: name });
      onDone();
    } catch (failure) {
      setError(failure instanceof ConvexError ? String(failure.data) : "Couldn't save the number");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <label className="sr-only" htmlFor="home-resident-name">Who lives here</label>
      <input id="home-resident-name" className={ON_PANEL_FIELD} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, like Boris" autoComplete="off" />
      <label className="sr-only" htmlFor="home-phone">Phone number</label>
      <input id="home-phone" className={ON_PANEL_FIELD} value={phone} onChange={(event) => setPhoneInput(event.target.value)} placeholder="(626) 555-0142" inputMode="tel" autoComplete="off" autoFocus required />
      {error && <p role="alert" className="type-small font-semibold text-signal">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="onPanelQuiet" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="onPanel" size="sm" disabled={saving || phone.trim() === ""}>
          {home.simulated ? "Call this number" : "Save number"}
        </Button>
      </div>
    </form>
  );
}

// The number the voice agent dials for this home. A simulated home has a made-up number the
// stand-in plays, so it offers to take a real one instead.
export function PhoneOnFile({ home }: { home: Home }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <NumberForm home={home} onDone={() => setEditing(false)} />;
  return (
    <div className="flex items-center gap-2">
      <Phone weight="bold" className="size-5 shrink-0" aria-hidden />
      {home.simulated ? (
        <span className="type-small flex-1 text-on-panel-muted">Simulated, no real phone</span>
      ) : (
        <a href={`tel:${home.callbackNumber}`} className="type-small flex-1 font-semibold tabular-nums">{phoneForPeople(home.callbackNumber)}</a>
      )}
      <Button variant="onPanelQuiet" size="sm" onClick={() => setEditing(true)}>
        {home.simulated ? "Add a real number" : "Change number"}
      </Button>
    </div>
  );
}
