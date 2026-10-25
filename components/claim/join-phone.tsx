"use client";

import { CheckCircle, HouseLine, QrCode as QrIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { BrandMark } from "@/components/ui/brand-mark";
import { PhoneScreen } from "@/components/ui/phone-screen";
import { PRODUCT_NAME } from "@/lib/brand";
import { PhoneForm } from "./phone-form";

type Session = NonNullable<ReturnType<typeof useQuery<typeof api.claims.session>>>;
type View = "loading" | "expired" | "ask" | "sent" | "claimed";

function viewOf(code: string | null, session: Session | null | undefined): View {
  if (!code || session === null) return "expired";
  if (session === undefined) return "loading";
  if (session.claimedAddress) return "claimed";
  if (session.expired) return "expired";
  return session.phoneEnding ? "sent" : "ask";
}

function Message({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      {icon}
      <h1 className="type-display">{title}</h1>
      <p className="type-body text-ink-muted">{children}</p>
    </div>
  );
}

function Body({ view, code, session }: { view: View; code: string | null; session: Session | null | undefined }) {
  if (view === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-surface-sunk" aria-hidden />;
  if (view === "expired") {
    return (
      <Message icon={<QrIcon weight="bold" className="size-10" aria-hidden />} title="This code ran out">
        Scan the new code on the big screen to sign in.
      </Message>
    );
  }
  if (view === "claimed") {
    return (
      <Message icon={<HouseLine weight="fill" className="size-10" aria-hidden />} title={`${session?.claimedAddress} is yours`}>
        When the evacuation warning goes out, our agent calls this phone. Answer as the person who lives there.
      </Message>
    );
  }
  if (view === "sent") {
    return (
      <Message icon={<CheckCircle weight="fill" className="size-10" aria-hidden />} title="Now pick your house on the big screen">
        We have the number ending {session?.phoneEnding}. Tap any open house on the map there.
      </Message>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="type-display">Send your number to the big screen</h1>
        <p className="type-body text-ink-muted">Your phone offers its own number above the keyboard. Tap it, then send.</p>
      </div>
      <PhoneForm code={code} submitLabel="Send my number" autoFocus />
    </div>
  );
}

// The page the kiosk's QR opens on a judge's phone. One field, one button, then it follows the big
// screen: it says when to pick a house, and which house they took.
export function JoinPhone({ code }: { code: string | null }) {
  const session = useQuery(api.claims.session, code ? { code } : "skip");
  const view = viewOf(code, session);
  const reduceMotion = useReducedMotion();
  return (
    <PhoneScreen surface="canvas">
      <div className="flex flex-1 flex-col gap-10 px-5 pt-6 pb-8">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-6" />
          <span className="type-heading font-brand">{PRODUCT_NAME}</span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            aria-live="polite"
          >
            <Body view={view} code={code} session={session} />
          </motion.div>
        </AnimatePresence>
        <p className="type-caption mt-auto text-ink-muted">We call this number only during the demo, and delete it after the event.</p>
      </div>
    </PhoneScreen>
  );
}
