"use client";

import { ToggleButton } from "@heroui/react";

/**
 * A row of choices. Single choice, or several with `multi`. `swatches` puts a colour dot before a label (skin, hair,
 * eyes); `ariaLabel` names the group for assistive technology when the visible label is short ("Colour" under "Hair").
 */
export function Choices({ label, ariaLabel, hint, options, value, onChange, multi, disabled, swatches }: {
  label: string; ariaLabel?: string; hint?: string; options: readonly (readonly [string, string, ...unknown[]])[];
  value: string | string[]; onChange: (v: string | string[]) => void; multi?: boolean; disabled?: (v: string) => boolean;
  swatches?: Record<string, string>;
}) {
  const chosen = (v: string) => (multi ? (value as string[]).includes(v) : value === v);
  return (
    <div role="group" aria-label={ariaLabel ?? label}>
      <div className="ow-eyebrow mb-2">{label}</div>
      {hint ? <p className="text-sm text-black/60 -mt-1 mb-2">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <ToggleButton key={l as string} isSelected={chosen(v)} isDisabled={disabled?.(v)} className="rounded-none"
            onChange={() => onChange(multi ? (chosen(v) ? (value as string[]).filter((x) => x !== v) : [...(value as string[]), v]) : v)}>
            {swatches?.[v] ? (
              <span aria-hidden className="inline-block w-3.5 h-3.5 rounded-full mr-2 shrink-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18),0_0_0_1px_rgba(255,255,255,0.5)]" style={{ background: swatches[v] }} />
            ) : null}
            {l}
          </ToggleButton>
        ))}
      </div>
    </div>
  );
}
