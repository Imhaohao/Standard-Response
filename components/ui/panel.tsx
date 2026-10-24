import { ReactNode } from "react";

// A card that floats over the map. The map is the subject; cards hold the decisions.
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
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-2xl bg-panel text-on-panel shadow-float ${className}`}>
      <header className="flex min-h-11 items-center justify-between gap-2 px-4 pt-1">
        <h2 className="type-heading">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="type-small px-4 py-6 text-center text-on-panel-muted">{children}</p>;
}
