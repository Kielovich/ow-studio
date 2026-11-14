import sharp from "sharp";

/** Share of the image height removed from the top of a fit reference: the head of a standing figure. */
export const FIT_HEAD_SHARE = 0.22;

/**
 * A fit reference shows how garments sit on a body. It may show a real person, so the top of the image (where the head
 * of a standing figure is) is removed before it is ever sent: the generator gets length, looseness and where hems and
 * waist sit, never a face to copy. The prompt also tells it to ignore the person. JPEG, long edge at most 1600 px.
 */
export async function cropFitReference(bytes: Uint8Array): Promise<Uint8Array> {
  const img = sharp(bytes).rotate();
  const m = await img.metadata();
  const w = m.autoOrient?.width ?? m.width!;
  const h = m.autoOrient?.height ?? m.height!;
  const top = Math.round(h * FIT_HEAD_SHARE);
  const out = await sharp(bytes).rotate().extract({ left: 0, top, width: w, height: h - top })
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 }).toBuffer();
  return new Uint8Array(out);
}
