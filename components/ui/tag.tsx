import { ReactNode } from "react";

// A short standing label on a panel: a caveat like "simulated", or the technique a panel runs on.
export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="type-small inline-flex w-fit items-center rounded-full bg-panel-raised px-2.5 py-0.5 font-semibold text-on-panel-muted">
      {children}
    </span>
  );
}
