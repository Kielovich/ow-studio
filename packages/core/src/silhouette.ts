import sharp from "sharp";

/**
 * Measures the silhouette of a bottoms packshot (garment on a flat light background).
 * Image models tend to slim and taper trousers; numbers taken from the packshot give the prompt something
 * concrete to hold on to. Deterministic; values are rounded to 2 decimals so they hash stably.
 */
export type BottomsSilhouette = {
  kind: "bottoms";
  /** Width of one leg at the hem divided by its width at the upper thigh (1 = no taper). */
  hemToThigh: number;
  /** Distance between the outer edges of both hems divided by the hip width (1 = legs fall straight from the hips). */
  hemSpanToHip: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

export function measureBottomsSilhouetteRaw(rgb: Uint8Array, W: number, H: number, bg: [number, number, number] = [241, 241, 241], threshold = 18): BottomsSilhouette | null {
  const segs: [number, number][][] = [];
  for (let y = 0; y < H; y++) {
    const row: [number, number][] = [];
    let start = -1, last = -1;
    for (let x = 0; x < W; x++) {
      const i = 3 * (y * W + x);
      const on = Math.max(Math.abs(rgb[i]! - bg[0]), Math.abs(rgb[i + 1]! - bg[1]), Math.abs(rgb[i + 2]! - bg[2])) > threshold;
      if (!on) continue;
      if (start < 0) start = x;
      else if (x > last + 3) { if (last - start > 8) row.push([start, last]); start = x; }
      last = x;
    }
    if (start >= 0 && last - start > 8) row.push([start, last]);
    segs.push(row);
  }
  const rows = segs.map((s, y) => ({ s, y })).filter((r) => r.s.length > 0);
  if (rows.length < 20) return null;
  const top = rows[0]!.y, bottom = rows[rows.length - 1]!.y, h = bottom - top;
  // Crotch = start of the longest continuous run of two-segment rows (a logo or button can split the waistband).
  let bestStart = -1, bestLen = 0, runStart = -1;
  for (let y = top; y <= bottom + 1; y++) {
    const two = y <= bottom && segs[y]!.length === 2;
    if (two && runStart < 0) runStart = y;
    if (!two && runStart >= 0) {
      if (y - runStart > bestLen) { bestLen = y - runStart; bestStart = runStart; }
      runStart = -1;
    }
  }
  if (bestLen < h * 0.3) return null;
  const crotch = bestStart;
  const width = (s: [number, number]) => s[1] - s[0];
  const at = (y: number) => segs[Math.min(bottom, Math.max(top, Math.round(y)))]!;
  // Hip: widest single-segment row above the crotch.
  let hip = 0;
  for (let y = top; y < crotch; y++) for (const s of segs[y]!) hip = Math.max(hip, width(s));
  const thighRow = at(crotch + 0.05 * h), hemRow = at(bottom - 0.03 * h);
  if (thighRow.length !== 2 || hemRow.length !== 2 || hip === 0) return null;
  const thigh = (width(thighRow[0]!) + width(thighRow[1]!)) / 2;
  const hem = (width(hemRow[0]!) + width(hemRow[1]!)) / 2;
  const span = hemRow[1]![1] - hemRow[0]![0];
  return { kind: "bottoms", hemToThigh: r2(hem / thigh), hemSpanToHip: r2(span / hip) };
}

export async function measureBottomsSilhouette(image: Uint8Array): Promise<BottomsSilhouette | null> {
  const { data, info } = await sharp(image).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return measureBottomsSilhouetteRaw(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
}

/** Prompt sentence for a measured silhouette. */
export function silhouetteText(s: BottomsSilhouette): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const taper = s.hemToThigh >= 0.95 ? "does not narrow at all" : s.hemToThigh >= 0.8 ? "narrows only slightly" : "tapers";
  return (
    `Measured leg shape from the packshot: each leg ${taper} from thigh to hem (hem width about ${pct(s.hemToThigh)} of the upper-thigh width), ` +
    `and the outer edges of the legs fall nearly straight down from the hips (the span across both hems is about ${pct(s.hemSpanToHip)} of the hip width). ` +
    `Keep this leg volume on the body; the legs must not look slimmer or more tapered than this.`
  );
}
