import { Icon } from "@phosphor-icons/react";
import { CaretDown } from "@phosphor-icons/react";
import { ReactNode } from "react";

// Detail lives behind a one-line summary that already carries the key fact.
export function Disclosure({ icon: SummaryIcon, title, fact, children }: { icon: Icon; title: string; fact: ReactNode; children: ReactNode }) {
  return (
    <details className="group overflow-hidden card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 hover:bg-panel-raised/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
        <SummaryIcon weight="fill" className="size-5 shrink-0" aria-hidden />
        <span className="type-heading shrink-0">{title}</span>
        <span className="type-body min-w-0 flex-1 truncate text-right font-bold tabular-nums">{fact}</span>
        <CaretDown weight="bold" className="size-4 shrink-0 text-on-panel-muted transition-transform duration-150 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}
