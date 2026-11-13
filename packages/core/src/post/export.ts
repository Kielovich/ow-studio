import sharp from "sharp";

/** Delivery format agreed with the client: square 2000 x 2000 px JPEG, sRGB. */
export const DELIVERY = { size: 2000, quality: 95 } as const;

/**
 * Final delivery file: exactly size x size px, sRGB with an embedded profile, JPEG at high quality without chroma
 * subsampling. The provider returns 2048 px at its 2K tier (the largest square it gives at 2K), so this is a small
 * Lanczos downscale, never an upscale of a smaller image without saying so. A non-square input is fitted on the
 * studio background instead of being cropped. Deterministic.
 */
export async function exportDelivery(input: Uint8Array, opts: { size?: number; quality?: number; background?: [number, number, number] } = {}):
  Promise<{ bytes: Uint8Array; sourceWidth: number; sourceHeight: number; upscaled: boolean }> {
  const size = opts.size ?? DELIVERY.size;
  const quality = opts.quality ?? DELIVERY.quality;
  const [r, g, b] = opts.background ?? [241, 241, 241];
  const meta = await sharp(input).metadata();
  const w = meta.width!, h = meta.height!;
  const out = await sharp(input)
    .removeAlpha()
    .toColourspace("srgb")
    .resize({ width: size, height: size, fit: "contain", background: { r, g, b }, kernel: "lanczos3" })
    .withIccProfile("srgb")
    .jpeg({ quality, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { bytes: new Uint8Array(out), sourceWidth: w, sourceHeight: h, upscaled: Math.max(w, h) < size };
}
