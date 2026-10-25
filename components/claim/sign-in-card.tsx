"use client";

import { useSyncExternalStore } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { PRODUCT_NAME } from "@/lib/brand";
import { PhoneForm } from "./phone-form";
import { QrCode } from "./qr-code";

const noSubscription = () => () => {};
const browserOrigin = () => window.location.origin;
const noOrigin = () => null;

// The link the QR opens: the phone page for this sign-in, on whatever host the kiosk runs on.
function useJoinUrl(code: string | null) {
  const origin = useSyncExternalStore(noSubscription, browserOrigin, noOrigin);
  return origin && code ? `${origin}/join?k=${code}` : null;
}

// Step one on the big screen. A judge either scans the code and sends their number from their own
// phone, or types it here. Either way the kiosk moves on by itself once the number arrives.
export function SignInCard({ code, error }: { code: string | null; error: string | null }) {
  const joinUrl = useJoinUrl(code);
  return (
    <section aria-labelledby="sign-in-heading" className="card w-full max-w-4xl p-6 sm:p-10">
      <div className="flex items-center gap-2.5">
        <BrandMark className="size-6" />
        <span className="type-heading font-brand">{PRODUCT_NAME}</span>
      </div>
      <h1 id="sign-in-heading" className="type-display mt-6 max-w-[18ch]">
        Our agent will call you at a house you pick
      </h1>
      <p className="type-body mt-3 max-w-[52ch] text-ink-muted">
        Sign in with your phone number. When the evacuation warning goes out, you answer as the person who lives there.
      </p>

      <div className="mt-8 grid items-center gap-6 md:grid-cols-[auto_auto_1fr] md:gap-8">
        <div className="flex items-center gap-4 md:flex-col md:items-start">
          <QrCode text={joinUrl} label="QR code that opens the sign-in page on your phone" className="w-32 shrink-0 md:w-52" />
          <p className="type-small max-w-[22ch] text-ink-muted">Scan with your phone camera to send your number from there.</p>
        </div>
        <div className="flex items-center gap-3 md:h-full md:flex-col" aria-hidden>
          <span className="h-px flex-1 bg-line md:h-auto md:w-px" />
          <span className="type-small font-semibold text-ink-muted">or</span>
          <span className="h-px flex-1 bg-line md:h-auto md:w-px" />
        </div>
        <PhoneForm code={code} submitLabel="Continue" />
      </div>

      {error && (
        <p role="alert" className="type-small mt-4 font-semibold text-signal">
          {error}
        </p>
      )}
      <p className="type-caption mt-6 text-ink-muted">We call this number only during the demo, and delete it after the event.</p>
    </section>
  );
}
