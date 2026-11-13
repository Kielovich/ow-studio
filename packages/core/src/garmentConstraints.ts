import type { GarmentFlag, PresetId } from "./schemas";

/** Construction-specific instructions, keyed by garment flag. Versioned together with the templates. */
export const GARMENT_CONSTRAINTS: Record<GarmentFlag, string> = {
  sheer: "Transparency level and lining placement exactly as in the packshot; the body is visible through the fabric only where the packshot is unlined.",
  lace: "Lace pattern, scalloped edges and openness of the lace exactly as in the packshot; no simplified or invented motifs.",
  sequin: "Individual sequins stay distinct with small reflections consistent with soft frontal light; no melted, blurred or smeared surface.",
  fur: "Faux fur pile length, direction and volume as in the packshot; individual fibres visible at the edges.",
  leather: "Faux leather grain and sheen as in the packshot; highlights soft, not wet-looking.",
  coated: "Coated finish with the low, soft sheen shown in the packshot; it must not read as glossy leather or vinyl. Contrast topstitching stays clearly visible.",
  satin: "Satin sheen follows the folds of the fabric; soft highlights, no plastic look.",
  denim: "Denim wash, fading, seams and hardware exactly as in the packshot.",
  open_back: "The back is open as in the back packshot; front views must not reveal back construction that is not visible from the front.",
  asymmetric_hem: "Hem asymmetry on the same side of the garment as in the packshot (garment left/right, not image left/right).",
  one_shoulder: "Single shoulder strap on the same garment side as in the packshot; the other shoulder is bare.",
  halter: "Halter neckline and neck fastening exactly as in the packshot.",
  long_sleeve: "Sleeves reach the wrist as in the packshot; cuffs are visible.",
  has_pockets: "Pockets exactly where the packshot shows them.",
  front_closure: "Front closure (buttons, hooks or zip) placement and count exactly as in the packshot.",
  slit: "Slit position and height exactly as in the packshot.",
  cutout: "Cut-outs in exactly the shape, size and position shown in the packshot.",
};

export function garmentConstraintLines(flags: readonly GarmentFlag[], preset: PresetId): string[] {
  return flags
    .filter((f) => !(f === "open_back" && preset === "detail"))
    .map((f) => GARMENT_CONSTRAINTS[f]);
}
