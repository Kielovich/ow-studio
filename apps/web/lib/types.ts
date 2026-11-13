import type { Category, GarmentFlag, PresetId } from "@ow-studio/core/src/schemas";

export type { Category, GarmentFlag, PresetId };

export const CATEGORIES: Category[] = ["dress", "top", "bodysuit", "trousers", "skirt", "shorts", "jacket", "coat", "knit"];

export const FLAGS: { id: GarmentFlag; label: string }[] = [
  { id: "sheer", label: "Sheer / mesh" }, { id: "lace", label: "Lace" }, { id: "sequin", label: "Sequins" },
  { id: "fur", label: "Fur" }, { id: "leather", label: "Leather" }, { id: "coated", label: "Coated" },
  { id: "satin", label: "Satin" }, { id: "denim", label: "Denim" }, { id: "open_back", label: "Open back" },
  { id: "asymmetric_hem", label: "Asymmetric hem" }, { id: "one_shoulder", label: "One shoulder" },
  { id: "halter", label: "Halter" }, { id: "long_sleeve", label: "Long sleeve" }, { id: "has_pockets", label: "Pockets" },
  { id: "front_closure", label: "Front closure" }, { id: "slit", label: "Slit" }, { id: "cutout", label: "Cut-out" },
];

export const PRESET_LABELS: Record<PresetId, string> = {
  full_body: "Front", three_quarter_full: "Three-quarter", back_full: "Back", styled_full: "Styled", detail: "Close-up",
  front_crop: "Front crop", three_quarter: "Three-quarter crop", back: "Back crop",
};

export const BRAND_SET: PresetId[] = ["full_body", "three_quarter_full", "back_full", "styled_full", "detail"];

export type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

export const STATE_LABEL: Record<string, { label: string; color: ChipColor }> = {
  queued: { label: "Queued", color: "default" },
  submitting: { label: "Sending", color: "accent" },
  provider_running: { label: "Generating", color: "accent" },
  validating: { label: "Finishing", color: "accent" },
  succeeded: { label: "Done", color: "success" },
  needs_review: { label: "Review", color: "warning" },
  awaiting_approval: { label: "Needs approval", color: "warning" },
  failed: { label: "Failed", color: "danger" },
  cancelled: { label: "Cancelled", color: "default" },
};

export const ACTIVE_STATES = new Set(["queued", "submitting", "provider_running", "validating"]);

export const DEFAULT_MAKEUP =
  "polished editorial fashion makeup: even, luminous skin that still shows natural texture and pores; softly sculpted cheekbones and jawline; " +
  "groomed, defined brows; subtle smudged brown liner and lengthening mascara; neutral nude-rose matte lip. Fashion-model polish, not glam, not bare-faced.";

export const assetUrl = (hash: string | null | undefined, w?: 240 | 480 | 800 | 1200) =>
  hash ? `/api/assets/${hash.replace(/^sha256:/, "")}${w ? `?w=${w}` : ""}` : "";

export const usd = (n: number) => `$${n.toFixed(2)}`;
