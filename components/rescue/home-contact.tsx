"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { FormEvent, KeyboardEvent, ReactNode, Ref, useEffect, useRef, useState } from "react";
import { Check, PencilSimple, Phone, Translate } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { FILE_LANGUAGES, isHeardOnlyLanguage, languageInEnglish, languageName } from "@/convex/languages";
import { Button } from "@/components/ui/button";
import { ON_PANEL_FIELD } from "@/components/ui/field";
import { phoneForPeople } from "@/lib/labels";
import { formatPhoneAsTyped } from "@/lib/phone-number";

type Home = {
  _id: Id<"households">;
  callbackNumber: string;
  residentName?: string;
  simulated: boolean;
  language: string;
  callStatus: string;
};

type Draft = { phone: string; language: string; name: string; takeOff: boolean };
type Changes = { phone?: string | null; language?: string; residentName?: string };
type NumberKeeper = NonNullable<ReturnType<typeof useQuery<typeof api.homeEdits.numberState>>>["keeper"];

const SAVED_SHOWN_MS = 2500;
const SPOKEN = FILE_LANGUAGES.filter((code) => !isHeardOnlyLanguage(code));
const HEARD_ONLY = FILE_LANGUAGES.filter(isHeardOnlyLanguage);

const digitsOf = (phone: string) => phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const startingPhone = (home: Home) => (home.simulated ? "" : phoneForPeople(home.callbackNumber));

function phoneChange(home: Home, draft: Draft, numberLocked: boolean): Changes["phone"] {
  if (numberLocked) return undefined;
  if (draft.takeOff) return null;
  const typed = draft.phone.trim();
  if (typed === "" || digitsOf(typed) === digitsOf(home.callbackNumber)) return undefined;
  return typed;
}

// Only what the dispatcher changed goes to the server, so an untouched field never overwrites a newer value.
function changesOf(home: Home, draft: Draft, numberLocked: boolean): Changes {
  const changes: Changes = {};
  const phone = phoneChange(home, draft, numberLocked);
  if (phone !== undefined) changes.phone = phone;
  if (draft.language !== home.language) changes.language = draft.language;
  if (!draft.takeOff && draft.name.trim() !== (home.residentName ?? "")) changes.residentName = draft.name;
  return changes;
}

function languageLabel(code: string) {
  const english = languageInEnglish(code);
  const native = languageName(code);
  return native === english ? english : `${english} (${native})`;
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  const className = "type-small font-semibold text-on-panel-muted";
  return htmlFor ? <label htmlFor={htmlFor} className={className}>{children}</label> : <span className={className}>{children}</span>;
}

function keeperNote(keeper: NonNullable<NumberKeeper>) {
  if (keeper.kind === "judge") return "A judge's phone. The judge kiosk owns this number.";
  return `${keeper.name}'s phone. Move it or switch it off in Real phones.`;
}

function LockedNumber({ home, note }: { home: Home; note: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel>Phone</FieldLabel>
      <p className="type-small font-semibold tabular-nums">{home.simulated ? "Simulated, no real phone" : phoneForPeople(home.callbackNumber)}</p>
      <p className="type-small text-on-panel-muted">{note}</p>
    </div>
  );
}

type PhoneFieldProps = { draft: Draft; setDraft: (next: Partial<Draft>) => void; canTakeOff: boolean; simulated: boolean };

function PhoneField({ draft, setDraft, canTakeOff, simulated }: PhoneFieldProps) {
  if (draft.takeOff) {
    return (
      <div className="flex flex-col gap-1">
        <FieldLabel>Phone</FieldLabel>
        <div className="flex items-start gap-2 rounded-lg bg-panel-raised px-3 py-2">
          <p className="type-small flex-1">Saving takes this number off. The house goes back to a made-up 555 number, so no real phone rings.</p>
          <Button variant="onPanelQuiet" size="sm" className="bg-panel" onClick={() => setDraft({ takeOff: false })}>Keep it</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel htmlFor="home-phone">{simulated ? "Real phone number" : "Phone"}</FieldLabel>
      <div className="flex gap-2">
        <input id="home-phone" className={ON_PANEL_FIELD} value={draft.phone} onChange={(event) => setDraft({ phone: formatPhoneAsTyped(event.target.value) })} placeholder="(626) 555-0142" inputMode="tel" autoComplete="off" autoFocus />
        {canTakeOff && (
          <Button variant="onPanelQuiet" size="sm" className="h-10" onClick={() => setDraft({ takeOff: true })}>Take off</Button>
        )}
      </div>
    </div>
  );
}

function LanguageField({ value, onChange }: { value: string; onChange: (language: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel htmlFor="home-language">Language for calls</FieldLabel>
      <select id="home-language" className={ON_PANEL_FIELD} value={value} onChange={(event) => onChange(event.target.value)}>
        {SPOKEN.map((code) => <option key={code} value={code}>{languageLabel(code)}</option>)}
        <optgroup label="The agent hands these calls to a person">
          {HEARD_ONLY.map((code) => <option key={code} value={code}>{languageLabel(code)}</option>)}
        </optgroup>
      </select>
    </div>
  );
}

function errorText(failure: unknown) {
  return failure instanceof ConvexError ? String(failure.data) : "Couldn't save. Check the connection and try again.";
}

type NumberState = ReturnType<typeof useQuery<typeof api.homeEdits.numberState>>;

function numberLockNote(home: Home, numberState: NumberState) {
  if (numberState === undefined) return "Checking who keeps this number…";
  if (numberState?.keeper) return keeperNote(numberState.keeper);
  if (home.callStatus === "in_call") return "On a call now. Change the number once it ends.";
  return null;
}

type ContactFormProps = { home: Home; numberState: NumberState; onCancel: () => void; onSaved: () => void };

function ContactForm({ home, numberState, onCancel, onSaved }: ContactFormProps) {
  const save = useMutation(api.homeEdits.save);
  const [draft, setDraftState] = useState<Draft>({ phone: startingPhone(home), language: home.language, name: home.residentName ?? "", takeOff: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const setDraft = (next: Partial<Draft>) => setDraftState((current) => ({ ...current, ...next }));

  const lockNote = numberLockNote(home, numberState);
  const changes = changesOf(home, draft, lockNote !== null);
  const unchanged = Object.keys(changes).length === 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await save({ householdId: home._id, ...changes });
      onSaved();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
    }
  }

  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") onCancel();
  };

  return (
    <form onSubmit={submit} onKeyDown={cancelOnEscape} aria-label="Edit this home's phone, language and name" className="flex flex-col gap-3">
      {lockNote ? <LockedNumber home={home} note={lockNote} /> : <PhoneField draft={draft} setDraft={setDraft} canTakeOff={numberState?.canTakeOff ?? false} simulated={home.simulated} />}
      <LanguageField value={draft.language} onChange={(language) => setDraft({ language })} />
      {!draft.takeOff && (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="home-resident-name">Who lives here</FieldLabel>
          <input id="home-resident-name" className={ON_PANEL_FIELD} value={draft.name} onChange={(event) => setDraft({ name: event.target.value })} placeholder="Name, like Boris" autoComplete="off" maxLength={60} />
        </div>
      )}
      {error && <p role="alert" className="type-small font-semibold text-signal">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="onPanelQuiet" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="onPanel" size="sm" disabled={saving || unchanged}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function SavedMark({ shown }: { shown: boolean }) {
  return (
    <span role="status" className="type-small flex items-center gap-1 font-semibold">
      {shown && (
        <>
          <Check weight="bold" className="size-4" aria-hidden />
          Saved
        </>
      )}
    </span>
  );
}

function ContactView({ home, saved, onEdit, editRef }: { home: Home; saved: boolean; onEdit: () => void; editRef: Ref<HTMLButtonElement> }) {
  const english = home.language === "en";
  return (
    <div className="flex items-start gap-2">
      <dl className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex items-center gap-2">
          <dt className="sr-only">Phone</dt>
          <Phone weight="bold" className="size-5 shrink-0" aria-hidden />
          <dd className="type-small min-w-0 truncate">
            {home.simulated ? (
              <span className="text-on-panel-muted">Simulated, no real phone</span>
            ) : (
              <a href={`tel:${home.callbackNumber}`} className="font-semibold tabular-nums">{phoneForPeople(home.callbackNumber)}</a>
            )}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">Language for calls</dt>
          <Translate weight="bold" className="size-5 shrink-0" aria-hidden />
          {/* A crew at the door needs to know before knocking that nobody inside may speak English. */}
          <dd className={`type-small ${english ? "text-on-panel-muted" : "font-semibold"}`}>{languageInEnglish(home.language)}</dd>
        </div>
      </dl>
      <SavedMark shown={saved} />
      <Button ref={editRef} variant="onPanelQuiet" size="sm" onClick={onEdit} aria-label="Edit phone, language and name">
        <PencilSimple weight="bold" className="size-4" aria-hidden />
        Edit
      </Button>
    </div>
  );
}

function useSavedFlash() {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), SAVED_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);
  return { saved: savedAt !== null, flash: () => setSavedAt(Date.now()) };
}

// The number the voice agent dials for this home and the language it calls in, with an editor behind
// "Edit". A simulated home has a made-up number the stand-in plays, so the editor offers a real one.
export function HomeContact({ home }: { home: Home }) {
  const [editing, setEditing] = useState(false);
  const { saved, flash } = useSavedFlash();
  const editRef = useRef<HTMLButtonElement>(null);
  // Asked for as soon as the card opens, so the editor knows at once whether the number is editable here.
  const numberState = useQuery(api.homeEdits.numberState, { householdId: home._id });
  const close = (didSave: boolean) => {
    setEditing(false);
    if (didSave) flash();
    requestAnimationFrame(() => editRef.current?.focus());
  };
  if (editing) return <ContactForm home={home} numberState={numberState} onCancel={() => close(false)} onSaved={() => close(true)} />;
  return <ContactView home={home} saved={saved} onEdit={() => setEditing(true)} editRef={editRef} />;
}
