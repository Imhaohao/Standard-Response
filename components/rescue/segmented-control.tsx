import { ComponentType } from "react";

type Option<Value extends string> = { value: Value; label: string; Icon?: ComponentType<{ weight?: "bold"; className?: string }> };

export function SegmentedControl<Value extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  iconOnly = false,
}: {
  options: readonly Option<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  ariaLabel: string;
  iconOnly?: boolean;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex shrink-0 items-center gap-0.5 rounded-xl bg-panel-raised p-0.5">
      {options.map(({ value: optionValue, label, Icon }) => {
        const active = optionValue === value;
        return (
          <button
            key={optionValue}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(optionValue)}
            className={`type-small inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-on-panel ${
              active ? "bg-on-panel text-panel" : "text-on-panel hover:bg-panel"
            }`}
          >
            {Icon && <Icon weight="bold" className="size-4" />}
            {!(iconOnly && Icon) && label}
          </button>
        );
      })}
    </div>
  );
}
