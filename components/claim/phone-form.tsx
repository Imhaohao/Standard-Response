"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { useMutation } from "convex/react";
import { FormEvent, useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatPhoneAsTyped } from "@/lib/phone-number";
import { FIELD, failureText } from "./controls";

// One number field and one button. `autoComplete="tel"` lets iOS and Android offer the phone's own
// number above the keyboard, so on a judge's phone it is one tap to fill and one to send. A browser
// can't read the number itself. The server turns it into a dialable +1 number.
export function PhoneForm({ code, submitLabel, onSent, autoFocus = false }: { code: string | null; submitLabel: string; onSent?: (phoneEnding: string) => void; autoFocus?: boolean }) {
  const submitPhone = useMutation(api.claims.submitPhone);
  const id = useId();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!code) return;
    setSending(true);
    setError(null);
    try {
      const { phoneEnding } = await submitPhone({ code, phone });
      onSent?.(phoneEnding);
    } catch (failure) {
      setError(failureText(failure, "Couldn't send the number. Try again."));
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-2">
      <label htmlFor={`${id}-phone`} className="type-small font-semibold">
        Your phone number
      </label>
      <input
        id={`${id}-phone`}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="(626) 555-0142"
        value={phone}
        onChange={(event) => setPhone(formatPhoneAsTyped(event.target.value))}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        autoFocus={autoFocus}
        required
        className={`${FIELD} type-title h-14`}
      />
      <p id={`${id}-error`} role="alert" className="type-small min-h-5 font-semibold text-signal">
        {error}
      </p>
      <Button type="submit" size="lg" disabled={!code || sending || phone.trim() === ""} className="w-full">
        {sending ? "Sending…" : submitLabel}
        <ArrowRight weight="bold" className="size-5" />
      </Button>
    </form>
  );
}
