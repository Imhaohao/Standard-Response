"use client";

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel"
    >
      <span className={`relative h-5 w-9 shrink-0 border ${checked ? "border-on-panel bg-on-panel" : "border-on-panel-muted"}`}>
        <span
          className={`absolute top-0.5 left-0.5 size-4 transition-transform duration-150 ease-[var(--ease-standard)] ${
            checked ? "translate-x-4 bg-panel" : "bg-on-panel-muted"
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
