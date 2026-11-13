import sharp from "sharp";

/*
 * Deterministic background normalisation.
 *
 * Image models render "light grey" at whatever level they like (RGB 165-210 in tests), often with a gradient.
 * This step replaces it with an exact flat target (default RGB 241) while keeping contact shadows and soft edges:
 *
 * 1. Fit a smooth quadratic model of the existing background per channel from neutral border samples (robust refits).
 * 2. Background = pixels that are neutral and either match the model or are a shadow of it (darker, same hue),
 *    flood-filled from the image border, plus large enclosed pockets (e.g. between arm and torso) that clearly match.
 * 3. In a thin band around the subject, estimate how much background each pixel contains from luminance
 *    (alpha between the local subject level and the background model), so hair and edges blend without a halo.
 * 4. Background pixels become target * shade, where shade is the luminance ratio to the model below 97% (real
 *    shadows keep their relative depth; render noise and colour cast are removed). Edge-band pixels blend:
 *    out = obs + alpha * (target - model).
 *
 * Same input and options always give the same output.
 */

export type BackgroundOptions = {
  target?: [number, number, number];
  /** Max per-channel distance from the background model to count as background. */
  tolerance?: number;
  /** Max chroma (max-min channel) above the background's own chroma for background and shadow pixels. */
  chromaMax?: number;
  /** Max chroma of the backdrop itself. A tinted backdrop (lilac, warm grey) is fine; a coloured one is refused. */
  backdropChromaMax?: number;
  /** Darkest shadow, as a fraction of the background model luminance, still treated as background. */
  shadowMin?: number;
  /** Minimum size of an enclosed background pocket, as a fraction of the image area. */
  enclosedMinFraction?: number;
  /** Width of the soft-edge band around the subject, in pixels. */
  band?: number;
};

export type BackgroundReport = {
  ok: boolean;
  reason?: string;
  width: number;
  height: number;
  backgroundFraction: number;
  enclosedPockets: number;
  modelMeanBefore: [number, number, number];
  cornerMeansAfter: [number, number, number][];
};

const DEFAULTS: Required<BackgroundOptions> = {
  target: [241, 241, 241],
  tolerance: 14,
  chromaMax: 12,
  backdropChromaMax: 30,
  shadowMin: 0.55,
  enclosedMinFraction: 0.0004,
  band: 3,
};

type Coefs = [number[], number[], number[]];

function solve6(A: number[][], b: number[]): number[] | null {
  const n = 6;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

const feats = (x: number, y: number) => [1, x, y, x * x, x * y, y * y];

function fit(samples: { x: number; y: number; v: [number, number, number] }[]): Coefs | null {
  const coefs: number[][] = [];
  for (let ch = 0; ch < 3; ch++) {
    const A = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const b = new Array(6).fill(0);
    for (const s of samples) {
      const f = feats(s.x, s.y);
      for (let i = 0; i < 6; i++) {
        b[i] += f[i]! * s.v[ch]!;
        for (let j = 0; j < 6; j++) A[i]![j] += f[i]! * f[j]!;
      }
    }
    // Light ridge regularisation keeps the fit stable when samples sit only on the border.
    for (let i = 1; i < 6; i++) A[i]![i] += 1e-3 * samples.length;
    const c = solve6(A, b);
    if (!c) return null;
    coefs.push(c);
  }
  return coefs as Coefs;
}

const evalC = (c: number[], x: number, y: number) => c[0]! + c[1]! * x + c[2]! * y + c[3]! * x * x + c[4]! * x * y + c[5]! * y * y;

export function normalizeBackgroundRaw(rgb: Uint8Array, W: number, H: number, options: BackgroundOptions = {}): { out: Uint8Array; report: BackgroundReport; mask?: Uint8Array } {
  const o = { ...DEFAULTS, ...options };
  const N = W * H;
  const lum = new Float32Array(N);
  const chroma = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = rgb[3 * i]!, g = rgb[3 * i + 1]!, b = rgb[3 * i + 2]!;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    chroma[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const fail = (reason: string) => ({
    out: rgb.slice(),
    report: { ok: false, reason, width: W, height: H, backgroundFraction: 0, enclosedPockets: 0, modelMeanBefore: [0, 0, 0] as [number, number, number], cornerMeansAfter: [] },
  });

  // 1. Robust quadratic background model.
  const step = Math.max(2, Math.floor(Math.min(W, H) / 128));
  const border = Math.max(2, Math.round(Math.min(W, H) * 0.03));
  const grid: { x: number; y: number; i: number; border: boolean }[] = [];
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    grid.push({ x, y, i: y * W + x, border: x < border || y < border || x >= W - border || y >= H - border });
  }
  const sample = (g: { x: number; y: number; i: number }) => ({ x: g.x / W, y: g.y / H, v: [rgb[3 * g.i]!, rgb[3 * g.i + 1]!, rgb[3 * g.i + 2]!] as [number, number, number] });
  // Chroma is judged relative to the backdrop's own tint: models often render a lilac or warm grey (chroma ~10),
  // and an absolute neutrality test then rejects noisy backdrop pixels one by one, which leaves speckles.
  const borderChroma = grid.filter((g) => g.border).map((g) => chroma[g.i]!).sort((a, b) => a - b);
  const tint = borderChroma[Math.floor(borderChroma.length / 2)] ?? 0;
  if (tint > o.backdropChromaMax) return fail("too few neutral border pixels");
  const chromaLimit = tint + o.chromaMax;
  const neutralBorder = grid.filter((g) => g.border && chroma[g.i]! < chromaLimit);
  if (neutralBorder.length < 30) return fail("too few neutral border pixels");
  const sortedLum = neutralBorder.map((g) => lum[g.i]!).sort((a, b) => a - b);
  const medLum = sortedLum[Math.floor(sortedLum.length / 2)]!;
  let coefs = fit(neutralBorder.filter((g) => Math.abs(lum[g.i]! - medLum) < 25).map(sample));
  if (!coefs) return fail("background fit failed");
  for (let it = 0; it < 3; it++) {
    const c = coefs;
    const keep = grid.filter((g) => {
      if (chroma[g.i]! >= chromaLimit) return false;
      const x = g.x / W, y = g.y / H;
      let d = 0;
      for (let ch = 0; ch < 3; ch++) d = Math.max(d, Math.abs(rgb[3 * g.i + ch]! - evalC(c[ch]!, x, y)));
      return d < o.tolerance;
    });
    if (keep.length < 30) break;
    coefs = fit(keep.map(sample)) ?? coefs;
  }
  const model = new Float32Array(3 * N);
  const mean: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const ny = y / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      for (let ch = 0; ch < 3; ch++) {
        const v = evalC(coefs[ch]!, x / W, ny);
        model[3 * i + ch] = v;
        mean[ch] = mean[ch]! + v / N;
      }
    }
  }

  // 2. Background candidates, flood fill from the border, then large enclosed pockets.
  const cand = new Uint8Array(N);
  const dist = new Float32Array(N);
  const bg = new Uint8Array(N);
  const queue = new Int32Array(N);
  let pockets = 0;
  const classify = () => {
  cand.fill(0);
  bg.fill(0);
  pockets = 0;
  for (let i = 0; i < N; i++) {
    let d = 0;
    for (let ch = 0; ch < 3; ch++) d = Math.max(d, Math.abs(rgb[3 * i + ch]! - model[3 * i + ch]!));
    dist[i] = d;
    const mlum = 0.299 * model[3 * i]! + 0.587 * model[3 * i + 1]! + 0.114 * model[3 * i + 2]!;
    const ratio = lum[i]! / mlum;
    const mchroma = Math.max(model[3 * i]!, model[3 * i + 1]!, model[3 * i + 2]!) - Math.min(model[3 * i]!, model[3 * i + 1]!, model[3 * i + 2]!);
    if (chroma[i]! < mchroma + o.chromaMax && (d < o.tolerance || (ratio >= o.shadowMin && ratio <= 1.05))) cand[i] = 1;
  }
  const flood = (seeds: number[], into: Uint8Array, mark: number, collect?: number[]) => {
    let head = 0, tail = 0;
    for (const s of seeds) if (cand[s] && !into[s]) { into[s] = mark; queue[tail++] = s; }
    while (head < tail) {
      const i = queue[head++]!;
      collect?.push(i);
      const x = i % W, y = (i / W) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const n of nb) if (n >= 0 && cand[n] && !into[n]) { into[n] = mark; queue[tail++] = n; }
    }
  };
  const borderSeeds: number[] = [];
  for (let x = 0; x < W; x++) borderSeeds.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) borderSeeds.push(y * W, y * W + W - 1);
  flood(borderSeeds, bg, 1);

  const seen = new Uint8Array(N);
  const minArea = Math.max(16, Math.round(o.enclosedMinFraction * N));
  for (let i = 0; i < N; i++) {
    if (!cand[i] || bg[i] || seen[i]) continue;
    const comp: number[] = [];
    flood([i], seen, 1, comp);
    if (comp.length < minArea) continue;
    let md = 0;
    for (const p of comp) md += dist[p]!;
    if (md / comp.length < o.tolerance * 0.6) { for (const p of comp) bg[p] = 1; pockets++; }
  }
  };

  // 2b. Refined background model: a coarse grid of the actual background (upper-half luminance per cell, so
  // shadows smaller than a cell do not pull it down), holes filled by diffusion from neighbours, bilinearly
  // upsampled. This captures vignetting and uneven falloff that a quadratic misses. Contact shadows (smaller than
  // a cell) are preserved; large soft floor shading is flattened, which matches a clean e-commerce look.
  const refineModel = () => {
    const cell = Math.max(8, Math.round(Math.min(W, H) / 24));
    const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    const gv = new Float32Array(gw * gh * 3);
    const has = new Uint8Array(gw * gh);
    for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
      const idx: number[] = [];
      for (let y = cy * cell; y < Math.min(H, (cy + 1) * cell); y++) for (let x = cx * cell; x < Math.min(W, (cx + 1) * cell); x++) {
        const i = y * W + x;
        if (bg[i]) idx.push(i);
      }
      if (idx.length < cell * cell * 0.15) continue;
      const ls = idx.map((i) => lum[i]!).sort((a, b) => a - b);
      const med = ls[Math.floor(ls.length / 2)]!;
      const acc = [0, 0, 0];
      let n = 0;
      for (const i of idx) if (lum[i]! >= med) { for (let ch = 0; ch < 3; ch++) acc[ch] = acc[ch]! + rgb[3 * i + ch]!; n++; }
      const g = cy * gw + cx;
      for (let ch = 0; ch < 3; ch++) gv[3 * g + ch] = acc[ch]! / n;
      has[g] = 1;
    }
    if (has.some((h) => h)) {
      // Diffusion fill of cells without enough background (behind the subject).
      let pending = has.reduce((s, h) => s + (h ? 0 : 1), 0);
      while (pending > 0) {
        const snapshot = has.slice();
        for (let g = 0; g < gw * gh; g++) {
          if (snapshot[g]) continue;
          const cx = g % gw, cy = (g / gw) | 0;
          const acc = [0, 0, 0];
          let n = 0;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as const) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const ng = ny * gw + nx;
            if (!snapshot[ng]) continue;
            for (let ch = 0; ch < 3; ch++) acc[ch] = acc[ch]! + gv[3 * ng + ch]!;
            n++;
          }
          if (n) { for (let ch = 0; ch < 3; ch++) gv[3 * g + ch] = acc[ch]! / n; has[g] = 1; pending--; }
        }
      }
      for (let y = 0; y < H; y++) {
        const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
        const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
        for (let x = 0; x < W; x++) {
          const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
          const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
          const i = y * W + x;
          for (let ch = 0; ch < 3; ch++) {
            const a = gv[3 * (y0 * gw + x0) + ch]!, b = gv[3 * (y0 * gw + x1) + ch]!;
            const c = gv[3 * (y1 * gw + x0) + ch]!, d = gv[3 * (y1 * gw + x1) + ch]!;
            model[3 * i + ch] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
          }
        }
      }
    }
  };

  // Two passes: the second classification uses the refined model, which fixes edges the quadratic misfits.
  classify();
  refineModel();
  classify();
  refineModel();

  // 3. Soft-edge band: subject pixels within `band` px of the background.
  const band = new Uint8Array(N);
  let frontier = bg.slice();
  for (let k = 0; k < o.band; k++) {
    const next = frontier.slice();
    for (let i = 0; i < N; i++) {
      if (!frontier[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (n >= 0 && !bg[n] && !next[n]) { next[n] = 1; band[n] = 1; }
      }
    }
    frontier = next;
  }
  // Local subject luminance from core subject pixels (integral images over a window).
  const R = o.band + 3;
  const core = new Float32Array(N), coreLum = new Float32Array(N);
  for (let i = 0; i < N; i++) if (!bg[i] && !band[i]) { core[i] = 1; coreLum[i] = lum[i]!; }
  const integral = (a: Float32Array) => {
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) { row += a[y * W + x]!; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1]! + row; }
    }
    return I;
  };
  const Ic = integral(core), Il = integral(coreLum);
  const boxSum = (I: Float64Array, x: number, y: number) => {
    const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(W, x + R + 1), y1 = Math.min(H, y + R + 1);
    return I[y1 * (W + 1) + x1]! - I[y0 * (W + 1) + x1]! - I[y1 * (W + 1) + x0]! + I[y0 * (W + 1) + x0]!;
  };

  // 4. Composite.
  const out = new Uint8Array(3 * N);
  let bgCount = 0;
  for (let i = 0; i < N; i++) {
    let alpha = 0;
    let shadeBg = false;
    if (bg[i]) { alpha = 1; shadeBg = true; bgCount++; }
    else if (band[i]) {
      const x = i % W, y = (i / W) | 0;
      const cnt = boxSum(Ic, x, y);
      if (cnt > 0) {
        const lf = boxSum(Il, x, y) / cnt;
        const mlum = 0.299 * model[3 * i]! + 0.587 * model[3 * i + 1]! + 0.114 * model[3 * i + 2]!;
        const denom = mlum - lf;
        if (Math.abs(denom) >= 15) alpha = Math.min(1, Math.max(0, (lum[i]! - lf) / denom));
      }
    }
    // Shadows keep their relative depth; anything brighter than the model is flattened to the target.
    // Deviations within 3% are noise and become flat target; real shadows scale continuously below that.
    // The ratio is taken on luminance, the same for all channels: per-channel ratios turned channel noise on a
    // tinted backdrop into coloured speckles.
    const mlumPx = 0.299 * model[3 * i]! + 0.587 * model[3 * i + 1]! + 0.114 * model[3 * i + 2]!;
    const ratio = lum[i]! / mlumPx;
    const shade = shadeBg && ratio < 0.97 ? ratio / 0.97 : 1;
    for (let ch = 0; ch < 3; ch++) {
      const obs = rgb[3 * i + ch]!;
      const m = model[3 * i + ch]!;
      // Pure background becomes exactly the target (scaled by its shadow depth): no cast, no render noise.
      // The soft-edge band blends the observed pixel towards that, so hair and edges keep their detail.
      const v = shadeBg ? o.target[ch]! * shade : obs + alpha * (o.target[ch]! - m) * shade;
      out[3 * i + ch] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }

  const corner = (x0: number, y0: number): [number, number, number] => {
    const s = Math.max(4, Math.round(Math.min(W, H) * 0.01));
    const acc = [0, 0, 0];
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) for (let ch = 0; ch < 3; ch++) acc[ch] = acc[ch]! + out[3 * (y * W + x) + ch]!;
    return acc.map((v) => Math.round(v / (s * s))) as [number, number, number];
  };
  const s = Math.max(4, Math.round(Math.min(W, H) * 0.01));
  return {
    out,
    /** 255 = background, 128 = soft edge band, 0 = subject. Useful for review and debugging. */
    mask: (() => { const m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = bg[i] ? 255 : band[i] ? 128 : 0; return m; })(),
    report: {
      ok: true,
      width: W,
      height: H,
      backgroundFraction: bgCount / N,
      enclosedPockets: pockets,
      modelMeanBefore: mean.map((v) => Math.round(v)) as [number, number, number],
      cornerMeansAfter: [corner(0, 0), corner(W - s, 0), corner(0, H - s), corner(W - s, H - s)],
    },
  };
}

/** Decode, normalise and re-encode (JPEG q92, no chroma subsampling). */
export async function normalizeBackground(input: Uint8Array, options: BackgroundOptions = {}): Promise<{ bytes: Uint8Array; report: BackgroundReport }> {
  const { data, info } = await sharp(input).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { out, report } = normalizeBackgroundRaw(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, options);
  const bytes = await sharp(Buffer.from(out), { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  return { bytes: new Uint8Array(bytes), report };
}
