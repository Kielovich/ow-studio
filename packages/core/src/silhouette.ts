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

/**
 * Which image side the hem is longest on, measured from the garment's bottom profile.
 * Returns null when the two halves differ by less than 4% of the garment height (treated as symmetric).
 */
export function measureHemLowImageSideRaw(rgb: Uint8Array, W: number, H: number, bg: [number, number, number] = [241, 241, 241], threshold = 18): "image_left" | "image_right" | null {
  const bottom = new Int32Array(W).fill(-1);
  let top = H, low = -1, minX = W, maxX = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = 3 * (y * W + x);
    const on = Math.max(Math.abs(rgb[i]! - bg[0]), Math.abs(rgb[i + 1]! - bg[1]), Math.abs(rgb[i + 2]! - bg[2])) > threshold;
    if (!on) continue;
    bottom[x] = y;
    if (y < top) top = y;
    if (y > low) low = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  if (maxX - minX < 20 || low - top < 20) return null;
  const mid = (minX + maxX) / 2;
  let left = -1, right = -1;
  for (let x = minX; x <= maxX; x++) {
    const b = bottom[x]!;
    if (b < 0) continue;
    if (x < mid) left = Math.max(left, b);
    else right = Math.max(right, b);
  }
  const diff = (left - right) / (low - top);
  if (Math.abs(diff) < 0.04) return null;
  return diff > 0 ? "image_left" : "image_right";
}

/**
 * Hem orientation in wearer terms. On a front packshot the wearer's right appears on the image left;
 * on a back packshot it appears on the image right. The back packshot, when given, is a cross-check.
 */
export async function measureHemAsymmetry(front: Uint8Array, back?: Uint8Array): Promise<{ hemLowSide: "wearer_right" | "wearer_left"; backAgrees?: boolean } | null> {
  const raw = async (img: Uint8Array) => {
    const { data, info } = await sharp(img).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    return measureHemLowImageSideRaw(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
  };
  const f = await raw(front);
  if (!f) return null;
  const hemLowSide = f === "image_left" ? "wearer_right" : "wearer_left";
  if (!back) return { hemLowSide };
  const b = await raw(back);
  if (!b) return { hemLowSide };
  const backSide = b === "image_right" ? "wearer_right" : "wearer_left";
  return { hemLowSide, backAgrees: backSide === hemLowSide };
}

/**
 * Dominant garment colour from a packshot on a flat light background: median of the garment pixels,
 * as lowercase hex. Deterministic; null when no garment is found.
 */
export async function measureGarmentColour(image: Uint8Array, bg: [number, number, number] = [241, 241, 241], threshold = 18): Promise<string | null> {
  const { data, info } = await sharp(image).removeAlpha().toColourspace("srgb").resize({ width: 400, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const ch: number[][] = [[], [], []];
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[3 * i]!, g = data[3 * i + 1]!, b = data[3 * i + 2]!;
    if (Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2])) <= threshold) continue;
    ch[0]!.push(r); ch[1]!.push(g); ch[2]!.push(b);
  }
  if (ch[0]!.length < 100) return null;
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
  return "#" + ch.map((a) => med(a).toString(16).padStart(2, "0")).join("");
}

/**
 * Plain-fabric crop from a packshot on a flat light background: the largest square that lies entirely on the garment
 * (with a safety margin from every background pixel, so gaps such as between the legs never enter), nearest the
 * garment's centre of mass, cut at the packshot's native resolution. It shows the model how the surface really looks
 * (sheen, weave, pile, colour) without saying anything about shape. Deterministic; null when no square of at least
 * minSidePx fits (for example thin straps), so no misleading crop is ever sent.
 */
export async function cropFabric(
  image: Uint8Array,
  opts: { bg?: [number, number, number]; threshold?: number; marginPx?: number; minSidePx?: number; outSidePx?: number } = {},
): Promise<{ bytes: Uint8Array; box: { left: number; top: number; size: number } } | null> {
  const bg = opts.bg ?? [241, 241, 241];
  const threshold = opts.threshold ?? 18;
  const minSidePx = opts.minSidePx ?? 96;
  const outSidePx = opts.outSidePx ?? 512;
  const meta = await sharp(image).metadata();
  const W0 = meta.width!, H0 = meta.height!;
  // Work at up to 700 px: fine enough to keep narrow gaps (a 2 px gap at 1100 px is still a pixel here).
  const scale = Math.min(1, 700 / Math.max(W0, H0));
  const W = Math.round(W0 * scale), H = Math.round(H0 * scale);
  // Nearest-neighbour downscale: averaging would blend a thin background gap into the dark garment around it.
  const { data } = await sharp(image).removeAlpha().toColourspace("srgb").resize({ width: W, height: H, fit: "fill", kernel: "nearest" }).raw().toBuffer({ resolveWithObject: true });
  const N = W * H;
  const on = new Uint8Array(N);
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < N; i++) {
    const k = 3 * i;
    if (Math.max(Math.abs(data[k]! - bg[0]), Math.abs(data[k + 1]! - bg[1]), Math.abs(data[k + 2]! - bg[2])) > threshold) { on[i] = 1; sx += i % W; sy += (i / W) | 0; n++; }
  }
  if (n < 100) return null;
  const cx = sx / n, cy = sy / n;
  // Erode: a pixel counts only if no background pixel lies within the margin (box test via an integral image).
  const r = Math.max(1, Math.round((opts.marginPx ?? 8) * scale));
  const I = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += on[y * W + x]!; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1]! + row; } }
  const core = new Uint8Array(N);
  for (let y = r; y < H - r; y++) for (let x = r; x < W - r; x++) {
    const x0 = x - r, y0 = y - r, x1 = x + r + 1, y1 = y + r + 1;
    const cnt = I[y1 * (W + 1) + x1]! - I[y0 * (W + 1) + x1]! - I[y1 * (W + 1) + x0]! + I[y0 * (W + 1) + x0]!;
    if (cnt === (2 * r + 1) ** 2) core[y * W + x] = 1;
  }
  // Largest all-core square ending at each pixel (classic dynamic programme), then the best position.
  const dp = new Int32Array(N);
  let maxS = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!core[i]) continue;
    dp[i] = x && y ? 1 + Math.min(dp[i - 1]!, dp[i - W]!, dp[i - W - 1]!) : 1;
    if (dp[i]! > maxS) maxS = dp[i]!;
  }
  if (maxS * (1 / scale) < minSidePx) return null;
  // Among squares at least 85% of the largest, prefer the one nearest the garment centre (a calm, central area).
  const want = Math.floor(maxS * 0.85);
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (dp[y * W + x]! < want) continue;
    const x0 = x - want + 1, y0 = y - want + 1;
    const d = (x0 + want / 2 - cx) ** 2 + (y0 + want / 2 - cy) ** 2;
    if (!best || d < best.d) best = { x: x0, y: y0, d };
  }
  const left = Math.round(best!.x / scale), top = Math.round(best!.y / scale);
  const size = Math.min(W0 - left, H0 - top, Math.floor(want / scale));
  if (size < minSidePx) return null;
  const out = await sharp(image).removeAlpha().extract({ left, top, width: size, height: size })
    .resize({ width: Math.max(size, outSidePx), height: Math.max(size, outSidePx), kernel: "lanczos3" }).png().toBuffer();
  return { bytes: new Uint8Array(out), box: { left, top, size } };
}

// ---------- Colour drift (realism/QA, phase 3) ----------

function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Colour distance that tolerates studio exposure differences: lightness counts half, hue and chroma fully. */
export function colourDistance(a: string, b: string): number {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  const [L1, a1, b1] = srgbToLab(...p(a)), [L2, a2, b2] = srgbToLab(...p(b));
  return Math.sqrt(((L1 - L2) / 2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

export type ColourDrift = { measuredHex: string; distance: number; drift: boolean; sharePct: number };

/**
 * Does the generated image contain the garment's colour? Background and skin are removed, the rest is clustered
 * (k-means, k = 4, deterministic seeds) and the cluster nearest the packshot colour is compared with it. Because the
 * nearest cluster is used, styling in another colour cannot raise a false alarm; the flip side is that the check
 * cannot see a drift when the styling has the garment's colour (e.g. black on black). Flags only clear drifts.
 */
export async function measureColourDrift(image: Uint8Array, targetHex: string, opts: { threshold?: number; bg?: [number, number, number] } = {}): Promise<ColourDrift | null> {
  const threshold = opts.threshold ?? 12;
  const bg = opts.bg ?? [241, 241, 241];
  const { data, info } = await sharp(image).removeAlpha().toColourspace("srgb").resize({ width: 256, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const px: [number, number, number][] = [];
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[3 * i]!, g = data[3 * i + 1]!, b = data[3 * i + 2]!;
    if (Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2])) <= 14) continue;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (cr > 135 && cr < 180 && cb > 85 && cb < 135 && r > 60 && r > b) continue; // skin
    px.push([r, g, b]);
  }
  if (px.length < 200) return null;
  // Deterministic k-means: seeds at evenly spaced luminance quantiles.
  const lum = (p: number[]) => 0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!;
  const sorted = [...px].sort((a, b) => lum(a) - lum(b));
  let centres = [0.1, 0.4, 0.7, 0.95].map((q) => [...sorted[Math.floor(q * (sorted.length - 1))]!]);
  let assign = new Int32Array(px.length);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < px.length; i++) {
      let best = 0, bd = Infinity;
      centres.forEach((c, k) => { const d = (px[i]![0] - c[0]!) ** 2 + (px[i]![1] - c[1]!) ** 2 + (px[i]![2] - c[2]!) ** 2; if (d < bd) { bd = d; best = k; } });
      assign[i] = best;
    }
    centres = centres.map((c, k) => {
      const m = px.filter((_, i) => assign[i] === k);
      return m.length ? [0, 1, 2].map((ch) => m.reduce((s, p) => s + p[ch]!, 0) / m.length) : c;
    });
  }
  const hex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const scored = centres.map((c, k) => ({ k, hex: hex(c), d: colourDistance(hex(c), targetHex), n: assign.filter((a) => a === k).length }))
    .filter((c) => c.n >= px.length * 0.03); // ignore specks
  if (!scored.length) return null;
  const nearest = scored.sort((a, b) => a.d - b.d)[0]!;
  return { measuredHex: nearest.hex, distance: Math.round(nearest.d * 10) / 10, drift: nearest.d > threshold, sharePct: Math.round((nearest.n / px.length) * 100) };
}
