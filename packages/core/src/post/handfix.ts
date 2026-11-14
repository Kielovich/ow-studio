import sharp from "sharp";

/**
 * Local hand fix: only a square around a point the reviewer clicked is sent for an edit, then blended back with a
 * feathered edge. Every pixel outside the square is copied unchanged (lossless output), so the garment elsewhere,
 * the face and the background cannot change. Deterministic apart from the provider call.
 */
// v2 (2026-11-14): v1 only said "edit only the hand" and "keep everything exactly"; Nano Banana returned the crop
// unchanged (docs/review-and-import.md). v2 asks for a change of pose and describes the target, never the current gesture.
export const HAND_FIX_PROMPT = [
  "This is a crop from a studio fashion photograph. The hand in it looks posed, like a model's hand. Change its pose.",
  "Redraw the hand as a real person's hand hanging loosely at her side: the fingers relaxed and slightly apart, each finger bent a little differently, " +
  "the index finger straighter than the others, the thumb resting against the side of the index finger and not touching any other fingertip. " +
  "Visible knuckles, fine skin creases, short natural nails, five fingers, correct anatomy.",
  "The wrist and the sleeve stay exactly where they are. Keep everything else unchanged: the garment with its fabric, mesh, folds, seams and colour, " +
  "the skin tone, the background, the light and the framing. No text.",
].join("\n");

export type CropBox = { left: number; top: number; size: number };

/** A square of `fraction` of the shorter side centred on (x, y) in 0..1 image coordinates, clamped inside the image. */
export function handBox(width: number, height: number, x: number, y: number, fraction = 0.24): CropBox {
  const size = Math.max(64, Math.round(Math.min(width, height) * fraction));
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  return { left: clamp(Math.round(x * width - size / 2), width - size), top: clamp(Math.round(y * height - size / 2), height - size), size };
}

export async function cropForFix(image: Uint8Array, box: CropBox): Promise<Uint8Array> {
  return new Uint8Array(await sharp(image).removeAlpha().extract({ left: box.left, top: box.top, width: box.size, height: box.size }).png().toBuffer());
}

/**
 * Blends the edited crop back into the image. The edit is resized to the box, shifted so its outer ring matches the
 * original's mean colour (no visible seam from exposure drift), and blended with a linear feather of `feather` of the
 * box size. Output is PNG so nothing outside the box is re-encoded.
 */
export async function compositeFix(image: Uint8Array, box: CropBox, edited: Uint8Array, feather = 0.14): Promise<Uint8Array> {
  const base = await sharp(image).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const W = base.info.width, H = base.info.height, S = box.size;
  const ed = new Uint8Array(await sharp(edited).removeAlpha().toColourspace("srgb").resize(S, S, { fit: "fill" }).raw().toBuffer());
  const out = new Uint8Array(base.data);
  const f = Math.max(1, Math.round(S * feather));
  // Colour offset from the ring of width f just inside the box edge.
  const sum = [0, 0, 0, 0, 0, 0];
  let n = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (x >= f && y >= f && x < S - f && y < S - f) continue;
    const i = 3 * (y * S + x), j = 3 * ((box.top + y) * W + box.left + x);
    for (let c = 0; c < 3; c++) { sum[c] = sum[c]! + base.data[j + c]!; sum[c + 3] = sum[c + 3]! + ed[i + c]!; }
    n++;
  }
  const off = [0, 1, 2].map((c) => (sum[c]! - sum[c + 3]!) / n);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.min(x, y, S - 1 - x, S - 1 - y);
    const a = Math.min(1, d / f);
    if (a <= 0) continue;
    const i = 3 * (y * S + x), j = 3 * ((box.top + y) * W + box.left + x);
    for (let c = 0; c < 3; c++) {
      const v = ed[i + c]! + off[c]!;
      out[j + c] = Math.max(0, Math.min(255, Math.round(base.data[j + c]! * (1 - a) + v * a)));
    }
  }
  return new Uint8Array(await sharp(Buffer.from(out), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
}
