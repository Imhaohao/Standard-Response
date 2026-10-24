"use client";

export function Switch({
  checked,
  onChange,
  label,
  hint,
  className = "w-full px-3 py-2 hover:bg-panel-raised",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${className}`}
    >
      <span
        aria-hidden
        className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 ease-[var(--ease-standard)] ${
          checked ? "bg-on-panel" : "bg-line-strong"
        }`}
      >
        <span
          className={`size-5 rounded-full bg-panel shadow-[0_1px_2px_oklch(0.3_0.02_60/0.3)] transition-transform duration-150 ease-[var(--ease-standard)] ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="type-small block font-semibold">{label}</span>
        {hint && <span className="type-small block text-on-panel-muted">{hint}</span>}
      </span>
    </button>
  );
}
