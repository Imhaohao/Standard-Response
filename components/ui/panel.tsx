import { ReactNode } from "react";

// The dark surface that floats over the map. Paper is the map; decisions are made on panel.
export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col border border-panel-raised bg-panel/96 text-on-panel backdrop-blur-md ${className}`}>
      <header className="flex min-h-10 items-center justify-between gap-2 border-b border-panel-raised px-3">
        <h2 className="type-small font-bold">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="type-small px-3 py-6 text-center text-on-panel-muted">{children}</p>;
}
