import { ReactNode } from "react";

export function Section({
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
    <section className={`flex min-w-0 flex-col border border-line bg-surface ${className}`}>
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4">
        <h2 className="type-heading">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
