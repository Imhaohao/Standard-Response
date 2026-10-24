import { ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/brand";
import { AppNav } from "./app-nav";

export function PageShell({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh]">
      <header className="z-20 border-b border-line bg-surface/92 backdrop-blur-md lg:sticky lg:top-0">
        <div className="mx-auto flex min-h-16 max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 md:px-6">
          <div className="flex items-center gap-3">
            <span className="size-3.5 shrink-0 bg-signal" aria-hidden />
            <span className="type-title">{PRODUCT_NAME}</span>
          </div>
          <AppNav />
          {actions && <div className="ml-auto flex flex-wrap items-center gap-3">{actions}</div>}
        </div>
      </header>
      <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 pt-4 pb-16 md:px-6 md:pt-6">{children}</main>
    </div>
  );
}
