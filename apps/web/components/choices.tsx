"use client";

import { ToggleButton } from "@heroui/react";

/** A row of choices. Single choice, or several with `multi`. */
export function Choices({ label, hint, options, value, onChange, multi, disabled }: { label: string; hint?: string; options: readonly (readonly [string, string, ...unknown[]])[]; value: string | string[]; onChange: (v: string | string[]) => void; multi?: boolean; disabled?: (v: string) => boolean }) {
  const chosen = (v: string) => (multi ? (value as string[]).includes(v) : value === v);
  return (
    <div role="group" aria-label={label}>
      <div className="ow-eyebrow mb-2">{label}</div>
      {hint ? <p className="text-sm text-black/60 -mt-1 mb-2">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <ToggleButton key={l as string} isSelected={chosen(v)} isDisabled={disabled?.(v)} className="rounded-none"
            onChange={() => onChange(multi ? (chosen(v) ? (value as string[]).filter((x) => x !== v) : [...(value as string[]), v]) : v)}>
            {l}
          </ToggleButton>
        ))}
      </div>
    </div>
  );
}
